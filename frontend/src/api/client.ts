import axios from 'axios'
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../stores/authStore'

/**
 * Base URL. Defaults to the relative `/api/v1` path which the Vite dev server
 * proxies to the FastAPI backend (http://localhost:8000). Override with
 * VITE_API_URL for non-proxied / production deployments.
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export const REFRESH_TOKEN_KEY = 'alphalytic_refresh_token'

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// --- Request: attach the bearer token from the auth store ----------------------
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// --- Response: transparent refresh-and-retry on 401 ----------------------------
// A single shared promise prevents a stampede of refresh calls when several
// requests fail with 401 at the same time.
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) throw new Error('No refresh token available')

  // Use a bare axios call so this request doesn't re-enter the interceptors.
  const { data } = await axios.post<{
    access_token: string
    refresh_token?: string
  }>(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })

  useAuthStore.getState().setAccessToken(data.access_token)
  if (data.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
  }
  return data.access_token
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined
    const status = error.response?.status

    const isAuthEndpoint = original?.url?.includes('/auth/')
    if (status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true
      try {
        if (!refreshPromise) refreshPromise = refreshAccessToken()
        const newToken = await refreshPromise
        refreshPromise = null
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch (refreshError) {
        refreshPromise = null
        useAuthStore.getState().clear()
        if (
          typeof window !== 'undefined' &&
          window.location.pathname !== '/'
        ) {
          window.location.assign('/')
        }
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

/** Extract a human-readable message from an axios/unknown error. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { detail?: unknown; message?: unknown }
      | undefined
    const detail = data?.detail ?? data?.message
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      if (first?.msg) return first.msg
    }
    if (error.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the backend running?'
    if (error.message) return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}
