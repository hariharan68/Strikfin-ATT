import { create } from 'zustand'
import type { User } from '../api/endpoints'

const USER_KEY = 'strikfin_user'
const REFRESH_TOKEN_KEY = 'strikfin_refresh_token'

interface AuthState {
  /** Short-lived access token, kept in memory only. */
  accessToken: string | null
  /** Current authenticated user (persisted for nav display across reloads). */
  user: User | null
  isAuthenticated: boolean

  /** Persist a fresh login: access token in memory, refresh token in storage. */
  setSession: (tokens: { access_token: string; refresh_token: string }, user: User) => void
  setAccessToken: (accessToken: string) => void
  setUser: (user: User) => void
  /** Wipe all auth state and persisted tokens. */
  clear: () => void
}

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: loadUser(),
  isAuthenticated: false,

  setSession: (tokens, user) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ accessToken: tokens.access_token, user, isAuthenticated: true })
  },

  setAccessToken: (accessToken) => set({ accessToken, isAuthenticated: true }),

  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ user })
  },

  clear: () => {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ accessToken: null, user: null, isAuthenticated: false })
  },
}))

export { REFRESH_TOKEN_KEY, USER_KEY }
