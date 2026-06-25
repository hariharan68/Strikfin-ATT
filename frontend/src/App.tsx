import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { FloatingCopilot } from './components/FloatingCopilot'
import { ToastProvider } from './components/ui/Toast'
import { useAuthStore, REFRESH_TOKEN_KEY } from './stores/authStore'
import { getMe, refresh } from './api/endpoints'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { OptionsPage } from './pages/OptionsPage'
import { AdvanceOIPage } from './pages/AdvanceOIPage'

import { SignalsPage } from './pages/SignalsPage'
import { SmartMoneyPage } from './pages/SmartMoneyPage'
import { InstitutionalPage } from './pages/InstitutionalPage'
import { AllInOnePage } from './pages/all-in-1/AllInOnePage'
import { OptionChainPage } from './pages/OptionChainPage'
import { OptionsLabPage } from './pages/OptionsLabPage'
import { CopilotPage } from './pages/CopilotPage'
import { AdvancedDashboardPage } from './pages/AdvancedDashboardPage'
import { SettingsPage } from './pages/SettingsPage'

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-3 text-slate-500">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
          ⚡
        </span>
        <span className="text-sm font-medium">Loading Alphalytic AI…</span>
      </div>
    </div>
  )
}

/** Guards protected routes; restores a session from the refresh token if needed. */
function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const setUser = useAuthStore((s) => s.setUser)
  const [status, setStatus] = useState<'checking' | 'ok' | 'denied'>(
    accessToken ? 'ok' : 'checking',
  )

  useEffect(() => {
    if (accessToken) {
      setStatus('ok')
      return
    }
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      setStatus('denied')
      return
    }
    let active = true
    void (async () => {
      try {
        const tokens = await refresh(refreshToken)
        if (!active) return
        setAccessToken(tokens.access_token)
        if (tokens.refresh_token) {
          localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
        }
        const me = await getMe()
        if (!active) return
        setUser(me)
        setStatus('ok')
      } catch {
        if (!active) return
        localStorage.removeItem(REFRESH_TOKEN_KEY)
        setStatus('denied')
      }
    })()
    return () => {
      active = false
    }
  }, [accessToken, setAccessToken, setUser])

  if (status === 'checking') return <Splash />
  if (status === 'denied') return <Navigate to="/" replace />
  return <>{children}</>
}

function AppLayout() {
  const location = useLocation()
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">
        {/* keyed by route so each page eases in on navigation */}
        <div key={location.pathname} className="animate-page">
          <Outlet />
        </div>
      </main>
      <FloatingCopilot />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/advanced-dashboard" element={<AdvancedDashboardPage />} />
            <Route path="/options" element={<OptionsPage />} />
            <Route path="/advance-oi" element={<AdvanceOIPage />} />

            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/smart-money" element={<SmartMoneyPage />} />
            <Route path="/institutional" element={<InstitutionalPage />} />
            <Route path="/all-in-1" element={<AllInOnePage />} />
            <Route path="/option-chain" element={<OptionChainPage />} />
            <Route path="/options-lab" element={<OptionsLabPage />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
