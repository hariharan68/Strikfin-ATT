import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearFyersToken,
  getFyersLogin,
  getFyersStatus,
  type FyersStatus,
} from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import { useToast } from '../components/ui/Toast'
import { cn } from '../lib/format'
import { useTheme, type Theme } from '../lib/useTheme'

/** How long to keep polling the status endpoint after the popup opens. */
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes

type ConnectPhase = 'idle' | 'connecting'

export function SettingsPage() {
  const toast = useToast()
  const [status, setStatus] = useState<FyersStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [phase, setPhase] = useState<ConnectPhase>('idle')
  const [disconnecting, setDisconnecting] = useState(false)

  // Refs for the in-flight connect flow so cleanup can always reach them.
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
      // A failed status check shouldn't crash the page — surface once on load.
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

  // Cleanup any timers/popup if the user navigates away mid-connect.
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

  const handleConnect = useCallback(async () => {
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

    // Send the popup to the Fyers OAuth page.
    popup.location.href = login.login_url

    // Poll the backend until the token lands (callback saves it server-side).
    pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
    pollTimer.current = window.setInterval(async () => {
      // User closed the popup manually.
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

  const handleDisconnect = useCallback(async () => {
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

  const connected = Boolean(status?.connected)
  const hasToken = Boolean(status?.has_token)

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Personalise the look and feel of your workspace, and manage broker
          connections for Alphalytic AI.
        </p>
      </header>

      {/* Appearance / Theme picker */}
      <ThemeSection />

      {/* Fyers broker card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-lg text-white">
            ⚡
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Fyers Broker</h2>
              <StatusPill
                loading={loadingStatus}
                connected={connected}
                hasToken={hasToken}
              />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Connect your Fyers account to stream live NIFTY 50, SENSEX, India VIX
              and option-chain data. Tokens expire daily — just click connect each
              morning and log in once.
            </p>

            {status?.app_id && (
              <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <Detail label="App ID" value={status.app_id} />
                {status.generated_at && (
                  <Detail
                    label="Token generated"
                    value={new Date(status.generated_at).toLocaleString()}
                  />
                )}
              </dl>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleConnect}
                disabled={phase === 'connecting'}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'connecting' ? (
                  <>
                    <Spinner />
                    Waiting for login…
                  </>
                ) : connected ? (
                  'Reconnect Fyers'
                ) : (
                  'Connect Fyers'
                )}
              </button>

              {hasToken && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting || phase === 'connecting'}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>

            {phase === 'connecting' && (
              <p className="mt-3 text-xs text-slate-400">
                A Fyers login window has opened. Log in there — this page will detect
                the connection automatically.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Theme picker ──────────────────────────────────────────────

interface ThemeOption {
  id: Theme
  name: string
  description: string
  /** [page surface, card, accent] preview swatches. */
  swatches: [string, string, string]
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'classic',
    name: 'Classic Blue',
    description: 'Clean blue & white — the default look',
    swatches: ['#f0f4f8', '#ffffff', '#2350e8'],
  },
  {
    id: 'warm',
    name: 'Warm Cream',
    description: 'Terracotta & cream — easy on the eyes',
    swatches: ['#f1e8df', '#fbf8f4', '#c0561f'],
  },
  {
    id: 'dark',
    name: 'Dark Mode',
    description: 'Dark slate — low-light environments',
    swatches: ['#0a0e16', '#141b27', '#2350e8'],
  },
]

function ThemeSection() {
  const { theme, setTheme } = useTheme()

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        Appearance — Theme
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {THEME_OPTIONS.map((opt) => (
          <ThemeCard
            key={opt.id}
            option={opt}
            active={theme === opt.id}
            onSelect={() => setTheme(opt.id)}
          />
        ))}
      </div>
    </section>
  )
}

function ThemeCard({
  option,
  active,
  onSelect,
}: {
  option: ThemeOption
  active: boolean
  onSelect: () => void
}) {
  const [surface, card, accent] = option.swatches
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'press relative overflow-hidden rounded-2xl border bg-white p-3 text-left shadow-sm transition-all',
        active
          ? 'border-primary-500 ring-2 ring-primary-500/30'
          : 'border-slate-200 hover:border-slate-300',
      )}
    >
      {active && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Active
        </span>
      )}

      {/* Mini app preview */}
      <div
        className="flex h-24 flex-col gap-1.5 rounded-xl p-3"
        style={{ backgroundColor: surface }}
      >
        <div
          className="h-2 w-2/5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <div className="mt-1 space-y-1.5 rounded-lg p-2" style={{ backgroundColor: card }}>
          <div className="h-1.5 w-3/4 rounded-full bg-slate-300/70" />
          <div className="h-1.5 w-1/2 rounded-full bg-slate-300/50" />
        </div>
      </div>

      <div className="mt-3 px-1">
        <p className="text-sm font-bold text-slate-900">{option.name}</p>
        <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
      </div>
    </button>
  )
}

function StatusPill({
  loading,
  connected,
  hasToken,
}: {
  loading: boolean
  connected: boolean
  hasToken: boolean
}) {
  let tone: string
  let label: string
  if (loading) {
    tone = 'bg-slate-100 text-slate-500'
    label = 'Checking…'
  } else if (connected) {
    tone = 'bg-emerald-100 text-emerald-700'
    label = '● Connected'
  } else if (hasToken) {
    tone = 'bg-amber-100 text-amber-700'
    label = '● Token expired'
  } else {
    tone = 'bg-slate-100 text-slate-500'
    label = '● Not connected'
  }
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone,
      )}
    >
      {label}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-medium text-slate-700">{value}</dd>
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
