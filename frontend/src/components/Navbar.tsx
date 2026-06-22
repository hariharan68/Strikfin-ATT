import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { logout as logoutRequest } from '../api/endpoints'
import { REFRESH_TOKEN_KEY } from '../stores/authStore'
import { cn } from '../lib/format'
import { useToast } from './ui/Toast'
import { useTheme } from '../lib/useTheme'
import { Dropdown, menuItemClass } from './ui/Menu'

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
  { label: 'All in 1', to: '/all-in-1', isActive: (p) => p.startsWith('/all-in-1') },
  { label: 'Copilot', to: '/copilot', isActive: (p) => p.startsWith('/copilot') },
]

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

const linkClass = (active: boolean) =>
  cn(
    'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  )

/**
 * Computes how many leading nav items fit in the available width; the rest
 * collapse into a "More" dropdown so labels never truncate or overflow.
 */
function useOverflowNav(count: number) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(count)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const measure = measureRef.current
    if (!wrap || !measure) return

    const compute = () => {
      const widths = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth)
      const GAP = 4
      const MORE_W = 88
      const avail = wrap.clientWidth
      let used = 0
      let fit = 0
      for (let i = 0; i < widths.length; i++) {
        used += widths[i] + GAP
        const needsMore = i < widths.length - 1
        if (used + (needsMore ? MORE_W : 0) <= avail) fit++
        else break
      }
      setVisible(Math.max(1, Math.min(count, fit)))
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [count])

  return { wrapRef, measureRef, visible }
}

export function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const [loggingOut, setLoggingOut] = useState(false)
  const { isDark, toggle } = useTheme()
  const { wrapRef, measureRef, visible } = useOverflowNav(NAV_ITEMS.length)

  const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase()
  const shownItems = NAV_ITEMS.slice(0, visible)
  const overflowItems = NAV_ITEMS.slice(visible)
  const overflowActive = overflowItems.some((i) => i.isActive(location.pathname, location.search))

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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:bg-[#0e1320]/95">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 lg:px-6">
        {/* Brand */}
        <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
            ⚡
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight text-slate-900 sm:inline">
            Alphalytic AI
          </span>
        </Link>

        {/* Center nav — fits as many as possible, rest go to "More" */}
        <nav ref={wrapRef} className="relative flex min-w-0 flex-1 items-center gap-1">
          {shownItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={linkClass(item.isActive(location.pathname, location.search))}
            >
              {item.label}
            </Link>
          ))}

          {overflowItems.length > 0 && (
            <Dropdown
              align="left"
              trigger={({ toggle: t }) => (
                <button
                  type="button"
                  onClick={t}
                  className={cn(linkClass(overflowActive), 'flex items-center gap-1')}
                >
                  More <ChevronDown />
                </button>
              )}
            >
              {(close) =>
                overflowItems.map((item) => (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={close}
                    className={cn(
                      menuItemClass,
                      item.isActive(location.pathname, location.search) &&
                        'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                    )}
                  >
                    {item.label}
                  </Link>
                ))
              }
            </Dropdown>
          )}

          {/* Hidden measurer — same styling, used only to size items */}
          <div
            ref={measureRef}
            aria-hidden
            className="pointer-events-none absolute -top-[999px] left-0 flex gap-1 opacity-0"
          >
            {NAV_ITEMS.map((item) => (
              <span key={item.label} className={linkClass(false)}>
                {item.label}
              </span>
            ))}
          </div>
        </nav>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Toggle theme"
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* User dropdown — Settings + Logout live here */}
          <Dropdown
            trigger={({ toggle: t }) => (
              <button
                type="button"
                onClick={t}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
                  {initial}
                </span>
                <span className="hidden text-sm font-semibold text-slate-800 sm:inline">
                  {user?.display_name ?? 'User'}
                </span>
                <span className="text-slate-400">
                  <ChevronDown />
                </span>
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="text-sm font-semibold text-slate-800">
                    {user?.display_name ?? 'User'}
                  </div>
                  {user?.email && (
                    <div className="truncate text-xs text-slate-400">{user.email}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    navigate('/settings')
                  }}
                  className={menuItemClass}
                >
                  <SettingsIcon />
                  Settings
                </button>
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => {
                    close()
                    void handleLogout()
                  }}
                  className={cn(menuItemClass, 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50')}
                >
                  <LogoutIcon />
                  {loggingOut ? 'Signing out…' : 'Logout'}
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>
    </header>
  )
}
