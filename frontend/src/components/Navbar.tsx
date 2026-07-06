import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Zap,
  Construction,
  Layers,
  BarChart3,
  BarChart2,
  Scale,
  Target,
  Activity,
  GitCompare,
  LineChart,
  Workflow,
  Sparkles,
  Wind,
  CandlestickChart,
  Timer,
  AreaChart,
  Network,
  Waves,
  Gauge,
  Percent,
  Grid3x3,
  LayoutDashboard,
  Sigma,
  GitBranch,
  Flame,
  Bell,
  TrendingUp,
  PieChart,
  DollarSign,
  Landmark,
  LayoutGrid,
  Bot,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { logout as logoutRequest } from '../api/endpoints'
import { REFRESH_TOKEN_KEY } from '../stores/authStore'
import { cn } from '../lib/format'
import { useToast } from './ui/Toast'
import { useTheme } from '../lib/useTheme'
import { Dropdown, menuItemClass } from './ui/Menu'
import { InstrumentSearch } from './InstrumentSearch'

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
  /** Column header this item is grouped under in the mega-menu. */
  category: string
  isActive: (pathname: string) => boolean
}

interface NavGroup {
  kind: 'group'
  label: string
  subtitle: string
  isActive: (pathname: string, search: string) => boolean
  items: NavGroupItem[]
}

interface MegaItem {
  label: string
  slug: string
  isNew?: boolean
  icon: LucideIcon
}

interface MegaCategory {
  title: string
  items: MegaItem[]
}

interface NavMega {
  kind: 'mega'
  label: string
  /** Route the items link to, e.g. `/options-lab` → `/options-lab?tool=<slug>`. */
  basePath: string
  /** Small line under the mega-menu title. */
  subtitle: string
  isActive: (pathname: string, search: string) => boolean
  categories: MegaCategory[]
}

/** A placeholder tab for a feature that's still under development. */
interface NavSoon {
  kind: 'soon'
  label: string
  /** Show a dropdown caret (mirrors the dropdown-style tabs). */
  hasMenu?: boolean
}

/** A simple dropdown of plain page links (e.g. "Dashboards"). */
interface NavMenuLink {
  label: string
  to: string
  icon: LucideIcon
  isActive: (pathname: string, search: string) => boolean
}

interface NavMenu {
  kind: 'menu'
  label: string
  isActive: (pathname: string, search: string) => boolean
  items: NavMenuLink[]
}

type NavEntry = NavItem | NavGroup | NavMega | NavSoon | NavMenu

// ── Icons ──────────────────────────────────────────────────────────

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
      { label: 'Open Interest',    slug: 'open-interest',    icon: Layers },
      { label: 'Multi OI & Volume',slug: 'multi-oi-volume',  icon: BarChart3 },
      { label: 'Put-Call Ratio',   slug: 'put-call-ratio',   icon: Scale },
      { label: 'Max Pain',         slug: 'max-pain',         icon: Target },
      { label: 'Gamma Exposure',   slug: 'gamma-exposure',   icon: Activity, isNew: true },
    ],
  },
  {
    title: 'Popular Tools',
    items: [
      { label: 'PE-CE Difference', slug: 'pe-ce-difference', icon: GitCompare },
      { label: 'Timeseries',       slug: 'timeseries',       icon: LineChart },
      { label: 'Strategy Chart',   slug: 'strategy-chart',   icon: Workflow },
      { label: 'Smart OI',         slug: 'smart-oi',         icon: Sparkles, isNew: true },
      { label: 'Vega Analysis',    slug: 'vega-analysis',    icon: Wind,     isNew: true },
    ],
  },
  {
    title: 'Price Tools',
    items: [
      { label: 'ATM Straddle Chart',   slug: 'atm-straddle-chart',   icon: CandlestickChart },
      { label: 'Premium Decay',        slug: 'premium-decay',        icon: Timer },
      { label: 'Price vs OI',          slug: 'price-vs-oi',          icon: AreaChart },
      { label: 'MultiStrike Chart',    slug: 'multistrike-chart',    icon: BarChart2 },
      { label: 'Multi-Straddle Chart', slug: 'multi-straddle-chart', icon: Network },
    ],
  },
  {
    title: 'IV Tools',
    items: [
      { label: 'Volatility Skew',  slug: 'volatility-skew', icon: Waves },
      { label: 'IV/HV/IVP Chart',  slug: 'iv-hv-ivp-chart', icon: Gauge },
      { label: 'IV - HV',          slug: 'iv-hv',           icon: Percent },
      { label: 'IV Grid',          slug: 'iv-grid',         icon: Grid3x3 },
      { label: 'IV - Intraday',    slug: 'iv-intraday',     icon: Sigma,   isNew: true },
    ],
  },
  {
    title: 'Screeners',
    items: [
      { label: 'OI Crossover',      slug: 'oi-crossover',     icon: GitBranch },
      { label: 'Intraday Booster',  slug: 'intraday-booster', icon: Flame, isNew: true },
      { label: 'Option Triggers',   slug: 'option-triggers',  icon: Bell,  isNew: true },
    ],
  },
]

// ── Future Lab mega-menu data ──────────────────────────────────────

const FUTURE_LAB_CATEGORIES: MegaCategory[] = [
  {
    title: 'Price Tools',
    items: [
      { label: 'Future Dashboard', slug: 'future-dashboard', icon: Gauge },
      { label: 'Market Movers',    slug: 'market-movers',    icon: TrendingUp, isNew: true },
      { label: 'Future Heatmap',   slug: 'future-heatmap',   icon: Grid3x3 },
    ],
  },
  {
    title: 'OI Tools',
    items: [
      { label: 'Future Intraday',       slug: 'future-intraday',       icon: LineChart },
      { label: 'Price vs OI',           slug: 'price-vs-oi',           icon: AreaChart },
      { label: 'Future Sentiment Cycle',slug: 'future-sentiment-cycle',icon: PieChart },
    ],
  },
]

// ── Analyse mega-menu data ─────────────────────────────────────────

const ANALYSE_CATEGORIES: MegaCategory[] = [
  {
    title: 'FII / DII',
    items: [
      { label: 'FII/DII Summary',     slug: 'fii-dii-summary',     icon: Table },
      { label: 'FII/DII Cash Market', slug: 'fii-dii-cash-market', icon: LineChart },
    ],
  },
]

// ── Generic mega-dropdown (Options Lab, Future Lab, …) ─────────────

/** Static col-count classes so Tailwind generates them. */
const MEGA_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
}

function MegaDropdown({
  entry,
  pathname,
  search,
}: {
  entry: NavMega
  pathname: string
  search: string
}) {
  const active = entry.isActive(pathname, search)
  const cols = entry.categories.length

  return (
    <Dropdown
      align="center"
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
        <div style={{ width: Math.max(360, cols * 178) }}>
          {/* Header */}
          <div className="border-b border-slate-100 px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              {entry.label}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              {entry.subtitle}
            </p>
          </div>

          {/* Column grid */}
          <div className={cn('grid divide-x divide-slate-100', MEGA_COLS[cols] ?? 'grid-cols-5')}>
            {entry.categories.map((cat) => (
              <div key={cat.title} className="p-3">
                {/* Category header */}
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {cat.title}
                </p>
                {/* Items */}
                <ul className="space-y-0.5">
                  {cat.items.map((item) => {
                    const isActive = pathname === entry.basePath && search.includes(`tool=${item.slug}`)
                    const Icon = item.icon
                    return (
                      <li key={item.slug}>
                        <Link
                          to={`${entry.basePath}?tool=${item.slug}`}
                          onClick={close}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isActive ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400',
                            )}
                            strokeWidth={1.75}
                          />
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

/** A simple dropdown of page links (e.g. the "Dashboards" tab). */
function MenuDropdown({
  entry,
  pathname,
  search,
}: {
  entry: NavMenu
  pathname: string
  search: string
}) {
  const active = entry.isActive(pathname, search)
  return (
    <Dropdown
      align="left"
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} className={cn(linkClass(active), 'flex items-center gap-1')}>
          {entry.label}
          <ChevronDown open={open} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-52">
          {entry.items.map((item) => {
            const itemActive = item.isActive(pathname, search)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={close}
                className={cn(
                  menuItemClass,
                  itemActive && 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    itemActive ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400',
                  )}
                  strokeWidth={1.75}
                />
                <span className="flex-1 leading-snug">{item.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </Dropdown>
  )
}


/** An "under development" tab — opens a small coming-soon popover instead of navigating. */
function SoonTab({ label, hasMenu }: { label: string; hasMenu?: boolean }) {
  return (
    <Dropdown
      align="left"
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} className={cn(linkClass(false), 'flex items-center gap-1')}>
          {label}
          {hasMenu && <ChevronDown open={open} />}
        </button>
      )}
    >
      {() => (
        <div className="w-60 p-4 text-center">
          <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
            <Construction size={20} />
          </div>
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          <div className="mt-1 text-xs text-slate-500">This module is under development — coming soon.</div>
        </div>
      )}
    </Dropdown>
  )
}

// ── Nav entries ────────────────────────────────────────────────────

const NAV_ENTRIES: NavEntry[] = [
  {
    kind: 'menu',
    label: 'Dashboards',
    isActive: (p) =>
      p === '/dashboard' ||
      p.startsWith('/advanced-dashboard') ||
      (p.startsWith('/options') && !p.startsWith('/options-lab')),
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, isActive: (p) => p === '/dashboard' },
      { label: 'Advance Dashboard', to: '/advanced-dashboard', icon: Gauge, isActive: (p) => p.startsWith('/advanced-dashboard') },
      { label: 'Options', to: '/options', icon: CandlestickChart, isActive: (p) => p.startsWith('/options') && !p.startsWith('/options-lab') },
    ],
  },
  {
    kind: 'mega',
    label: 'Options Lab',
    basePath: '/options-lab',
    subtitle: 'Advanced analytics toolkit · All modules coming soon',
    isActive: (p) => p.startsWith('/options-lab'),
    categories: OPTIONS_LAB_CATEGORIES,
  } satisfies NavMega,
  {
    kind: 'mega',
    label: 'Future Lab',
    basePath: '/future-lab',
    subtitle: 'Futures analytics toolkit · All modules in development',
    isActive: (p) => p.startsWith('/future-lab'),
    categories: FUTURE_LAB_CATEGORIES,
  } satisfies NavMega,
  {
    kind: 'mega',
    label: 'Analyse',
    basePath: '/analyse',
    subtitle: 'FII / DII participant analytics · In development',
    isActive: (p) => p.startsWith('/analyse'),
    categories: ANALYSE_CATEGORIES,
  } satisfies NavMega,
  {
    kind: 'group',
    label: 'Smart Insights',
    subtitle: 'Analytics & intelligence tools',
    isActive: (p) =>
      p.startsWith('/smart-money') ||
      p.startsWith('/institutional') ||
      p.startsWith('/all-in-1') ||
      p.startsWith('/copilot'),
    items: [
      {
        label: 'Smart Money',
        to: '/smart-money',
        icon: <DollarSign size={18} strokeWidth={1.75} />,
        description: 'FII/DII positioning & institutional flow',
        category: 'Flow & Positioning',
        isActive: (p) => p.startsWith('/smart-money'),
      },
      {
        label: 'Institutional',
        to: '/institutional',
        icon: <Landmark size={18} strokeWidth={1.75} />,
        description: 'FII/DII cash & F&O participant activity',
        category: 'Flow & Positioning',
        isActive: (p) => p.startsWith('/institutional'),
      },
      {
        label: 'All in 1',
        to: '/all-in-1',
        icon: <LayoutGrid size={18} strokeWidth={1.75} />,
        description: '20-factor options intelligence dashboard',
        category: 'Intelligence',
        isActive: (p) => p.startsWith('/all-in-1'),
      },
      {
        label: 'Copilot',
        to: '/copilot',
        icon: <Bot size={18} strokeWidth={1.75} />,
        description: 'Ask the AI market-intelligence assistant',
        category: 'Intelligence',
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

// ── Smart Insights mega-dropdown (mirrors the Options Lab layout) ──
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

  // Group items into ordered columns by their `category`.
  const categories: string[] = []
  for (const it of group.items) if (!categories.includes(it.category)) categories.push(it.category)
  // Each real category + a trailing "Coming Soon" column.
  const cols = categories.length + 1

  return (
    <Dropdown
      align="center"
      menuClassName="p-0 overflow-hidden"
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
        <div style={{ width: cols * 224 }}>
          {/* Header */}
          <div className="border-b border-slate-100 px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              {group.label}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              {group.subtitle}
            </p>
          </div>

          {/* Column grid */}
          <div className={cn('grid divide-x divide-slate-100', MEGA_COLS[cols] ?? 'grid-cols-3')}>
            {categories.map((cat) => (
              <div key={cat} className="p-3">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {cat}
                </p>
                <ul className="space-y-0.5">
                  {group.items
                    .filter((it) => it.category === cat)
                    .map((item) => {
                      const itemActive = item.isActive(pathname)
                      return (
                        <li key={item.label}>
                          <Link
                            to={item.to}
                            onClick={() => { close(); onNavigate() }}
                            className={cn(
                              'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors',
                              itemActive
                                ? 'bg-primary-50 dark:bg-primary-900/20'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                            )}
                          >
                            <span className={cn('mt-0.5 shrink-0', itemActive ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400')}>
                              {item.icon}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className={cn('text-sm font-semibold leading-snug', itemActive ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800')}>
                                {item.label}
                              </span>
                              <span className="text-[11px] leading-snug text-slate-400">
                                {item.description}
                              </span>
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                </ul>
              </div>
            ))}

            {/* Coming Soon column */}
            <div className="p-3">
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Coming Soon
              </p>
              <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 opacity-60">
                <span className="mt-0.5 shrink-0 text-slate-400">
                  <Construction size={18} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold leading-snug text-slate-500">Historical Chart</span>
                  <span className="text-[11px] leading-snug text-slate-400">In development — coming soon</span>
                </span>
              </div>
            </div>
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
  const overflowActive = overflowEntries.some((e) => e.kind !== 'soon' && e.isActive(location.pathname, location.search))

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
            <Zap size={17} fill="currentColor" />
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight text-slate-900 sm:inline dark:text-white">
            Strikfin
          </span>
        </Link>

        {/* Center nav */}
        <nav ref={wrapRef} className="relative flex min-w-0 flex-1 items-center gap-1">
          {shownEntries.map((entry) => {
            if (entry.kind === 'menu') {
              return (
                <MenuDropdown
                  key={entry.label}
                  entry={entry}
                  pathname={location.pathname}
                  search={location.search}
                />
              )
            }
            if (entry.kind === 'mega') {
              return (
                <MegaDropdown
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
            if (entry.kind === 'soon') {
              return <SoonTab key={entry.label} label={entry.label} hasMenu={entry.hasMenu} />
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
                  if (entry.kind === 'menu') {
                    return (
                      <div key={entry.label}>
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {entry.label}
                        </div>
                        {entry.items.map((item) => {
                          const itemActive = item.isActive(location.pathname, location.search)
                          const Icon = item.icon
                          return (
                            <Link
                              key={item.to}
                              to={item.to}
                              onClick={close}
                              className={cn(
                                menuItemClass,
                                itemActive &&
                                  'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300',
                              )}
                            >
                              <Icon
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  itemActive ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400',
                                )}
                                strokeWidth={1.75}
                              />
                              <span className="flex-1 leading-snug">{item.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )
                  }
                  if (entry.kind === 'mega') {
                    return (
                      <div key={entry.label}>
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {entry.label}
                        </div>
                        {entry.categories.flatMap((cat) =>
                          cat.items.map((item) => {
                            const Icon = item.icon
                            return (
                            <Link
                              key={item.slug}
                              to={`${entry.basePath}?tool=${item.slug}`}
                              onClick={close}
                              className={cn(
                                menuItemClass,
                                'flex items-center gap-2',
                                location.pathname === entry.basePath &&
                                  location.search.includes(`tool=${item.slug}`) &&
                                  'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                              )}
                            >
                              <Icon className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                              {item.label}
                              {item.isNew && (
                                <span className="ml-1.5 rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                                  N
                                </span>
                              )}
                            </Link>
                            )
                          })
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
                  if (entry.kind === 'soon') {
                    return (
                      <div
                        key={entry.label}
                        className={cn(menuItemClass, 'flex cursor-not-allowed items-center justify-between text-slate-400')}
                        title="Under development"
                      >
                        {entry.label}
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                          Soon
                        </span>
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
                {(entry.kind === 'group' || entry.kind === 'mega' || entry.kind === 'menu' || (entry.kind === 'soon' && entry.hasMenu)) && <> ▾</>}
              </span>
            ))}
          </div>
        </nav>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Global instrument search — switch to any instrument */}
          <InstrumentSearch />

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
