import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { logout as logoutRequest } from '../api/endpoints'
import { REFRESH_TOKEN_KEY } from '../stores/authStore'
import { cn } from '../lib/format'
import { useToast } from './ui/Toast'
import { useTheme } from '../lib/useTheme'
import { Dropdown, menuItemClass } from './ui/Menu'

// ── Nav entry types ────────────────────────────────────────────────

interface NavItem {
  kind: 'item'
  label: string
  to: string
  isActive: (pathname: string, search: string) => boolean
}

interface NavGroupItem {
  label: string
  to: string
  icon: ReactNode
  description: string
  isActive: (pathname: string) => boolean
}

interface NavGroup {
  kind: 'group'
  label: string
  isActive: (pathname: string, search: string) => boolean
  items: NavGroupItem[]
}

interface MegaItem {
  label: string
  slug: string
  isNew?: boolean
}

interface MegaCategory {
  title: string
  items: MegaItem[]
}

interface NavMega {
  kind: 'mega'
  label: string
  isActive: (pathname: string, search: string) => boolean
  categories: MegaCategory[]
}

type NavEntry = NavItem | NavGroup | NavMega

// ── Icons ──────────────────────────────────────────────────────────

function AdvanceOIIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="18" y="3" width="4" height="18" rx="1" />
      <rect x="10" y="8" width="4" height="13" rx="1" />
      <rect x="2" y="13" width="4" height="8" rx="1" />
    </svg>
  )
}

function SignalsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function SmartMoneyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

function InstitutionalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <path d="M3 10 12 3l9 7" />
      <line x1="5" y1="21" x2="5" y2="10" />
      <line x1="19" y1="21" x2="19" y2="10" />
      <line x1="9" y1="21" x2="9" y2="13" />
      <line x1="15" y1="21" x2="15" y2="13" />
    </svg>
  )
}

function AllInOneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function CopilotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

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

function ChevronDown({ open }: { open?: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className={cn('transition-transform duration-200', open && 'rotate-180')}
    >
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

// ── Options Lab mega-menu data ─────────────────────────────────────

const OPTIONS_LAB_CATEGORIES: MegaCategory[] = [
  {
    title: 'OI Tools',
    items: [
      { label: 'Open Interest',    slug: 'open-interest' },
      { label: 'Multi OI & Volume',slug: 'multi-oi-volume' },
      { label: 'Put-Call Ratio',   slug: 'put-call-ratio' },
      { label: 'Max Pain',         slug: 'max-pain' },
      { label: 'Gamma Exposure',   slug: 'gamma-exposure', isNew: true },
    ],
  },
  {
    title: 'Popular Tools',
    items: [
      { label: 'PE-CE Difference', slug: 'pe-ce-difference' },
      { label: 'Timeseries',       slug: 'timeseries' },
      { label: 'Strategy Chart',   slug: 'strategy-chart' },
      { label: 'Smart OI',         slug: 'smart-oi',        isNew: true },
      { label: 'Vega Analysis',    slug: 'vega-analysis',   isNew: true },
    ],
  },
  {
    title: 'Price Tools',
    items: [
      { label: 'ATM Straddle Chart',   slug: 'atm-straddle-chart' },
      { label: 'Premium Decay',        slug: 'premium-decay' },
      { label: 'Price vs OI',          slug: 'price-vs-oi' },
      { label: 'MultiStrike Chart',    slug: 'multistrike-chart' },
      { label: 'Multi-Straddle Chart', slug: 'multi-straddle-chart' },
    ],
  },
  {
    title: 'IV Tools',
    items: [
      { label: 'Volatility Skew',  slug: 'volatility-skew' },
      { label: 'IV/HV/IVP Chart',  slug: 'iv-hv-ivp-chart' },
      { label: 'IV - HV',          slug: 'iv-hv' },
      { label: 'IV Grid',          slug: 'iv-grid' },
      { label: 'IV - Intraday',    slug: 'iv-intraday',    isNew: true },
    ],
  },
  {
    title: 'Screeners',
    items: [
      { label: 'OI Crossover',      slug: 'oi-crossover' },
      { label: 'Intraday Booster',  slug: 'intraday-booster', isNew: true },
      { label: 'Option Triggers',   slug: 'option-triggers',  isNew: true },
    ],
  },
]

// ── Options Lab mega-dropdown ──────────────────────────────────────

function OptionsLabDropdown({
  entry,
  pathname,
  search,
}: {
  entry: NavMega
  pathname: string
  search: string
}) {
  const active = entry.isActive(pathname, search)

  return (
    <Dropdown
      align="left"
      menuClassName="p-0 overflow-hidden"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(linkClass(active), 'flex items-center gap-1')}
        >
          {entry.label}
          <ChevronDown open={open} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[860px]">
          {/* Header */}
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Options Lab
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Advanced analytics toolkit · All modules coming soon
            </p>
          </div>

          {/* 5-column grid */}
          <div className="grid grid-cols-5 divide-x divide-slate-100 dark:divide-slate-700/60">
            {entry.categories.map((cat) => (
              <div key={cat.title} className="p-3">
                {/* Category header */}
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {cat.title}
                </p>
                {/* Items */}
                <ul className="space-y-0.5">
                  {cat.items.map((item) => {
                    const isActive = pathname === '/options-lab' && search.includes(`tool=${item.slug}`)
                    return (
                      <li key={item.slug}>
                        <Link
                          to={`/options-lab?tool=${item.slug}`}
                          onClick={close}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60',
                          )}
                        >
                          <span className="flex-1 leading-snug">{item.label}</span>
                          {item.isNew && (
                            <span className="shrink-0 rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                              N
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dropdown>
  )
}

// ── Nav entries ────────────────────────────────────────────────────

const NAV_ENTRIES: NavEntry[] = [
  { kind: 'item', label: 'Dashboard', to: '/dashboard', isActive: (p) => p === '/dashboard' },
  { kind: 'item', label: 'Advance Dashboard', to: '/advanced-dashboard', isActive: (p) => p.startsWith('/advanced-dashboard') },

  { kind: 'item', label: 'Options', to: '/options', isActive: (p) => p.startsWith('/options') && !p.startsWith('/options-lab') },
  {
    kind: 'mega',
    label: 'Options Lab',
    isActive: (p) => p.startsWith('/options-lab'),
    categories: OPTIONS_LAB_CATEGORIES,
  } satisfies NavMega,
  {
    kind: 'group',
    label: 'Smart Insights',
    isActive: (p) =>
      p.startsWith('/advance-oi') ||
      p.startsWith('/signals') ||
      p.startsWith('/smart-money') ||
      p.startsWith('/institutional') ||
      p.startsWith('/all-in-1') ||
      p.startsWith('/copilot'),
    items: [
      {
        label: 'Advance OI',
        to: '/advance-oi',
        icon: <AdvanceOIIcon />,
        description: 'OI build-up, strike flow & PCR analysis',
        isActive: (p) => p.startsWith('/advance-oi'),
      },
      {
        label: 'Signals',
        to: '/signals',
        icon: <SignalsIcon />,
        description: 'AI-driven bias & entry signals',
        isActive: (p) => p.startsWith('/signals'),
      },
      {
        label: 'Smart Money',
        to: '/smart-money',
        icon: <SmartMoneyIcon />,
        description: 'FII/DII positioning & institutional flow',
        isActive: (p) => p.startsWith('/smart-money'),
      },
      {
        label: 'Institutional',
        to: '/institutional',
        icon: <InstitutionalIcon />,
        description: 'FII/DII cash & F&O participant activity',
        isActive: (p) => p.startsWith('/institutional'),
      },
      {
        label: 'All in 1',
        to: '/all-in-1',
        icon: <AllInOneIcon />,
        description: '20-factor options intelligence dashboard',
        isActive: (p) => p.startsWith('/all-in-1'),
      },
      {
        label: 'Copilot',
        to: '/copilot',
        icon: <CopilotIcon />,
        description: 'Ask the AI market-intelligence assistant',
        isActive: (p) => p.startsWith('/copilot'),
      },
    ],
  },
  { kind: 'item', label: 'Option Chain', to: '/option-chain', isActive: (p) => p.startsWith('/option-chain') },
]

// ── Shared styles ──────────────────────────────────────────────────

const linkClass = (active: boolean) =>
  cn(
    'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  )

// ── Icon colour rings for group items ─────────────────────────────
const ICON_COLORS = [
  'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
  'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400',
]

// ── Smart Insights group dropdown ─────────────────────────────────
function SmartInsightsDropdown({
  group,
  pathname,
  search,
  onNavigate,
}: {
  group: NavGroup
  pathname: string
  search: string
  onNavigate: () => void
}) {
  const active = group.isActive(pathname, search)

  return (
    <Dropdown
      align="left"
      menuClassName="min-w-[320px] p-0 overflow-hidden"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(linkClass(active), 'flex items-center gap-1')}
        >
          {group.label}
          <ChevronDown open={open} />
        </button>
      )}
    >
      {(close) => (
        <div>
          {/* Header */}
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Smart Insights
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Analytics & intelligence tools
            </p>
          </div>

          {/* Items */}
          <div className="p-2">
            {group.items.map((item, i) => {
              const itemActive = item.isActive(pathname)
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => { close(); onNavigate() }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                    itemActive
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                  )}
                >
                  {/* Icon ring */}
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', ICON_COLORS[i % ICON_COLORS.length])}>
                    {item.icon}
                  </span>
                  {/* Text */}
                  <span className="flex flex-col">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        itemActive ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-200',
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="text-[11px] leading-snug text-slate-400">
                      {item.description}
                    </span>
                  </span>

                  {/* Active dot */}
                  {itemActive && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600" />
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </Dropdown>
  )
}

// ── Overflow-aware nav ─────────────────────────────────────────────

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

// ── Navbar ─────────────────────────────────────────────────────────

export function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const [loggingOut, setLoggingOut] = useState(false)
  const { isDark, toggle } = useTheme()
  const { wrapRef, measureRef, visible } = useOverflowNav(NAV_ENTRIES.length)

  const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase()
  const shownEntries = NAV_ENTRIES.slice(0, visible)
  const overflowEntries = NAV_ENTRIES.slice(visible)
  const overflowActive = overflowEntries.some((e) => e.isActive(location.pathname, location.search))

  async function handleLogout() {
    setLoggingOut(true)
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    try {
      if (refreshToken) await logoutRequest(refreshToken)
    } catch {
      // Always succeed locally.
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
          <span className="hidden text-[15px] font-bold tracking-tight text-slate-900 sm:inline dark:text-white">
            Alphalytic AI
          </span>
        </Link>

        {/* Center nav */}
        <nav ref={wrapRef} className="relative flex min-w-0 flex-1 items-center gap-1">
          {shownEntries.map((entry) => {
            if (entry.kind === 'mega') {
              return (
                <OptionsLabDropdown
                  key={entry.label}
                  entry={entry}
                  pathname={location.pathname}
                  search={location.search}
                />
              )
            }
            if (entry.kind === 'group') {
              return (
                <SmartInsightsDropdown
                  key={entry.label}
                  group={entry}
                  pathname={location.pathname}
                  search={location.search}
                  onNavigate={() => {}}
                />
              )
            }
            return (
              <Link
                key={entry.label}
                to={entry.to}
                className={linkClass(entry.isActive(location.pathname, location.search))}
              >
                {entry.label}
              </Link>
            )
          })}

          {/* Overflow "More" menu */}
          {overflowEntries.length > 0 && (
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
                overflowEntries.map((entry) => {
                  if (entry.kind === 'mega') {
                    return (
                      <div key={entry.label}>
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          Options Lab
                        </div>
                        {entry.categories.flatMap((cat) =>
                          cat.items.map((item) => (
                            <Link
                              key={item.slug}
                              to={`/options-lab?tool=${item.slug}`}
                              onClick={close}
                              className={cn(
                                menuItemClass,
                                location.pathname === '/options-lab' &&
                                  location.search.includes(`tool=${item.slug}`) &&
                                  'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                              )}
                            >
                              {item.label}
                              {item.isNew && (
                                <span className="ml-1.5 rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                                  N
                                </span>
                              )}
                            </Link>
                          ))
                        )}
                      </div>
                    )
                  }
                  if (entry.kind === 'group') {
                    return (
                      <div key={entry.label}>
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {entry.label}
                        </div>
                        {entry.items.map((item) => (
                          <Link
                            key={item.label}
                            to={item.to}
                            onClick={close}
                            className={cn(
                              menuItemClass,
                              item.isActive(location.pathname) &&
                                'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                            )}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )
                  }
                  return (
                    <Link
                      key={entry.label}
                      to={entry.to}
                      onClick={close}
                      className={cn(
                        menuItemClass,
                        entry.isActive(location.pathname, location.search) &&
                          'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                      )}
                    >
                      {entry.label}
                    </Link>
                  )
                })
              }
            </Dropdown>
          )}

          {/* Hidden measurer — one child per entry so overflow calc stays accurate */}
          <div
            ref={measureRef}
            aria-hidden
            className="pointer-events-none absolute -top-[999px] left-0 flex gap-1 opacity-0"
          >
            {NAV_ENTRIES.map((entry) => (
              <span key={entry.label} className={linkClass(false)}>
                {entry.label}
                {(entry.kind === 'group' || entry.kind === 'mega') && <> ▾</>}
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

          {/* User dropdown */}
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
                <span className="hidden text-sm font-semibold text-slate-800 sm:inline dark:text-slate-200">
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
                <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {user?.display_name ?? 'User'}
                  </div>
                  {user?.email && (
                    <div className="truncate text-xs text-slate-400">{user.email}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { close(); navigate('/settings') }}
                  className={menuItemClass}
                >
                  <SettingsIcon />
                  Settings
                </button>
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => { close(); void handleLogout() }}
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
