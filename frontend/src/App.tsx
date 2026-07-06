import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { Navbar } from './components/Navbar'
import { ToastProvider } from './components/ui/Toast'
import { useAuthStore } from './stores/authStore'
import { restoreSession } from './lib/session'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { OptionsPage } from './pages/OptionsPage'
import { SmartMoneyPage } from './pages/SmartMoneyPage'
import { InstitutionalPage } from './pages/InstitutionalPage'
import { AllInOnePage } from './pages/all-in-1/AllInOnePage'
import { OptionChainPage } from './pages/OptionChainPage'
import { OptionsLabPage } from './pages/OptionsLabPage'
import { FutureLabPage } from './pages/FutureLabPage'
import { AnalysePage } from './pages/AnalysePage'
import { CopilotPage } from './pages/CopilotPage'
import { AdvancedDashboardPage } from './pages/AdvancedDashboardPage'
import { AccountSettingsPage } from './components/settings/AccountSettingsPage'

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex items-center gap-3 text-slate-500">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Zap size={18} fill="currentColor" />
        </span>
        <span className="text-sm font-medium">Loading Strikfin…</span>
      </div>
    </div>
  )
}

/** Guards protected routes; restores a session from the refresh token if needed. */
function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [status, setStatus] = useState<'checking' | 'ok' | 'denied'>(
    accessToken ? 'ok' : 'checking',
  )

  useEffect(() => {
    if (accessToken) {
      setStatus('ok')
      return
    }
    let active = true
    // Coalesced restore — safe against StrictMode's double-invoke and any
    // concurrent caller, so the single-use refresh token is never raced.
    void restoreSession().then((ok) => {
      if (active) setStatus(ok ? 'ok' : 'denied')
    })
    return () => {
      active = false
    }
  }, [accessToken])

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
            <Route path="/smart-money" element={<SmartMoneyPage />} />
            <Route path="/institutional" element={<InstitutionalPage />} />
            <Route path="/all-in-1" element={<AllInOnePage />} />
            <Route path="/option-chain" element={<OptionChainPage />} />
            <Route path="/options-lab" element={<OptionsLabPage />} />
            <Route path="/future-lab" element={<FutureLabPage />} />
            <Route path="/analyse" element={<AnalysePage />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/settings" element={<AccountSettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
