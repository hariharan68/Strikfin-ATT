import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { logout as logoutRequest } from '../api/endpoints'
import { REFRESH_TOKEN_KEY } from '../stores/authStore'
import { cn } from '../lib/format'
import { useToast } from './ui/Toast'

interface NavItem {
  label: string
  to: string
  isActive: (pathname: string, search: string) => boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', isActive: (p) => p === '/dashboard' },
  { label: 'Advance Dashboard', to: '/advanced-dashboard', isActive: (p) => p.startsWith('/advanced-dashboard') },
  { label: 'Regime', to: '/regime', isActive: (p) => p.startsWith('/regime') },
  { label: 'Options', to: '/options', isActive: (p) => p.startsWith('/options') },
  { label: 'Advance OI', to: '/advance-oi', isActive: (p) => p.startsWith('/advance-oi') },
  { label: 'Signals', to: '/signals', isActive: (p) => p.startsWith('/signals') },
  { label: 'Smart Money', to: '/smart-money', isActive: (p) => p.startsWith('/smart-money') },
  { label: 'Institutional', to: '/institutional', isActive: (p) => p.startsWith('/institutional') },
  { label: 'Sentiment', to: '/sentiment', isActive: (p) => p.startsWith('/sentiment') },
  { label: 'Copilot', to: '/copilot', isActive: (p) => p.startsWith('/copilot') },
]

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const [loggingOut, setLoggingOut] = useState(false)

  const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase()

  async function handleLogout() {
    setLoggingOut(true)
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    try {
      if (refreshToken) await logoutRequest(refreshToken)
    } catch {
      // Logout should always succeed locally even if the API call fails.
    } finally {
      clear()
      toast.success('Signed out')
      navigate('/', { replace: true })
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 lg:px-6">
        {/* Brand */}
        <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
            ⚡
          </span>
          <span className="text-[15px] font-bold tracking-tight text-slate-900">Alphalytic AI</span>
        </Link>

        {/* Center nav */}
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(location.pathname, location.search)
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Toggle theme"
          >
            <MoonIcon />
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className={cn(
              'rounded-lg p-2 transition-colors',
              location.pathname.startsWith('/settings')
                ? 'bg-primary-100 text-primary-700'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
            )}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>

          <div className="mx-1 flex items-center gap-2.5 border-l border-slate-200 pl-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
              {initial}
            </span>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold text-slate-800">
                {user?.display_name ?? 'User'}
              </div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                User
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            {loggingOut ? '…' : 'Logout'}
          </button>
        </div>
      </div>
    </header>
  )
}
