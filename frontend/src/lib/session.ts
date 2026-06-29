import axios from 'axios'
import { refreshAccessTokenOnce } from '../api/client'
import { getMe } from '../api/endpoints'
import { useAuthStore, REFRESH_TOKEN_KEY } from '../stores/authStore'

/**
 * Boot-time session restore.
 *
 * The access token lives in memory only, so a page reload always starts with no
 * access token. We rebuild the session from the persisted (single-use) refresh
 * token: rotate it for a fresh access token, then load the current user.
 *
 * Coalesced into ONE shared promise so React StrictMode's double-invoked effect
 * (and any other concurrent caller) can't fire two refreshes with the same
 * single-use token — which is exactly what was logging users out on reload.
 */
let restorePromise: Promise<boolean> | null = null

async function doRestore(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) return false

  try {
    await refreshAccessTokenOnce() // sets access token (+ isAuthenticated) & rotates refresh token
    const me = await getMe()
    useAuthStore.getState().setUser(me)
    return true
  } catch (err) {
    // Only forget the session when the token is DEFINITIVELY rejected. A
    // transient network/server error keeps the token so a later reload retries
    // instead of bouncing the user to the login page.
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 401 || status === 403) {
      useAuthStore.getState().clear()
    }
    return false
  }
}

export function restoreSession(): Promise<boolean> {
  if (!restorePromise) {
    restorePromise = doRestore().finally(() => {
      restorePromise = null
    })
  }
  return restorePromise
}
