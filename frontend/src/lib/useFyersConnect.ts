import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearFyersToken,
  getFyersLogin,
  getFyersStatus,
  type FyersStatus,
} from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import { useToast } from '../components/ui/Toast'

/** How long to keep polling the status endpoint after the popup opens. */
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes

export type ConnectPhase = 'idle' | 'connecting'

/**
 * Encapsulates the Fyers OAuth popup + poll flow and disconnect. Lifted from
 * the original SettingsPage so both the broker row and the "+ Add" card can
 * share one live connection state.
 */
export function useFyersConnect() {
  const toast = useToast()
  const [status, setStatus] = useState<FyersStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [phase, setPhase] = useState<ConnectPhase>('idle')
  const [disconnecting, setDisconnecting] = useState(false)

  const popupRef = useRef<Window | null>(null)
  const pollTimer = useRef<number | null>(null)
  const pollDeadline = useRef<number>(0)

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const refreshStatus = useCallback(async (): Promise<FyersStatus | null> => {
    try {
      const s = await getFyersStatus()
      setStatus(s)
      return s
    } catch (e) {
      setStatus(null)
      console.error('Fyers status check failed:', getErrorMessage(e))
      return null
    }
  }, [])

  // Initial status load.
  useEffect(() => {
    void (async () => {
      await refreshStatus()
      setLoadingStatus(false)
    })()
  }, [refreshStatus])

  // Cleanup timers/popup on unmount.
  useEffect(() => {
    return () => {
      stopPolling()
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
    }
  }, [stopPolling])

  const finishConnecting = useCallback(
    (connected: boolean) => {
      stopPolling()
      setPhase('idle')
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
      popupRef.current = null
      if (connected) toast.success('Fyers connected — live data is now active')
    },
    [stopPolling, toast],
  )

  const connect = useCallback(async () => {
    setPhase('connecting')

    // Open the popup synchronously (inside the click) so browsers don't block it.
    const popup = window.open('about:blank', 'fyers_login', 'width=480,height=720')
    popupRef.current = popup
    if (!popup) {
      setPhase('idle')
      toast.error('Popup blocked. Please allow popups for this site and retry.')
      return
    }

    let login
    try {
      login = await getFyersLogin()
    } catch (e) {
      finishConnecting(false)
      toast.error(getErrorMessage(e, 'Could not start Fyers login'))
      return
    }

    popup.location.href = login.login_url

    pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
    pollTimer.current = window.setInterval(async () => {
      if (popupRef.current && popupRef.current.closed) {
        const s = await refreshStatus()
        finishConnecting(Boolean(s?.connected))
        return
      }
      if (Date.now() > pollDeadline.current) {
        finishConnecting(false)
        toast.error('Fyers connection timed out. Please try again.')
        return
      }
      const s = await refreshStatus()
      if (s?.connected) finishConnecting(true)
    }, POLL_INTERVAL_MS)
  }, [finishConnecting, refreshStatus, toast])

  const disconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await clearFyersToken()
      await refreshStatus()
      toast.success('Fyers disconnected')
    } catch (e) {
      toast.error(getErrorMessage(e, 'Could not disconnect Fyers'))
    } finally {
      setDisconnecting(false)
    }
  }, [refreshStatus, toast])

  return {
    status,
    loadingStatus,
    phase,
    disconnecting,
    connected: Boolean(status?.connected),
    hasToken: Boolean(status?.has_token),
    connect,
    disconnect,
  }
}
