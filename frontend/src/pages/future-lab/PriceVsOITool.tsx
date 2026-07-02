import { useEffect, useMemo, useState } from 'react'
import { Clock, Eye, EyeOff, LineChart, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { getPriceOiSeries, INSTRUMENTS } from '../../api/endpoints'
import type { InstrumentId, PriceOiSeries } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { cn } from '../../lib/format'
import { Skeleton } from '../../components/ui/Skeleton'
import { ErrorBanner } from '../../components/ui/Page'
import { PriceVsOIChart } from '../../components/future-lab/PriceVsOIChart'

// Upcoming weekly expiries (Tuesdays) for the Expiry dropdown.
function upcomingExpiries(from: Date, count = 6) {
  const base = new Date(from)
  base.setHours(0, 0, 0, 0)
  const out: { label: string; days: number }[] = []
  const d = new Date(base)
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1)
  for (let i = 0; i < count; i++) {
    const days = Math.round((d.getTime() - base.getTime()) / 86_400_000)
    out.push({
      label: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d),
      days,
    })
    d.setDate(d.getDate() + 7)
  }
  return out
}

function isMarketOpenIST(now: Date): boolean {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getHours() * 60 + ist.getMinutes()
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30
}

export function PriceVsOITool() {
  const [instrument, setInstrument] = useInstrument()
  const [showPrice, setShowPrice] = useState(true)
  const [showOi, setShowOi] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [expiry, setExpiry] = useState(0)

  const { data, error, loading, refreshing, refetch } = useFetch<PriceOiSeries>(
    () => getPriceOiSeries(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const expiries = useMemo(() => upcomingExpiries(new Date()), [])
  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'

  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  return (
    <div
      className="grid gap-2.5"
      style={{
        gridTemplateColumns: `${collapsed ? 34 : 208}px minmax(0,1fr)`,
        height: 'clamp(560px, calc(100vh - 120px), 880px)',
      }}
    >
      {/* ── Settings sidebar ─────────────────────────────────── */}
      {collapsed ? (
        <div className="flex h-full items-start justify-center rounded-lg border border-slate-200 bg-white pt-2 dark:border-slate-800 dark:bg-[#0f1623]">
          <button
            onClick={() => setCollapsed(false)}
            className="press flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Expand settings"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      ) : (
        <div className="h-full self-start rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#0f1623]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Settings</h3>
            <button
              onClick={() => setCollapsed(true)}
              className="press flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Collapse settings"
            >
              <ChevronsLeft size={15} />
            </button>
          </div>

          {/* Instrument */}
          <div className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
              {instrument === 1 ? '50' : 'SX'}
            </span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{instShort}</span>
            <span className="flex gap-0.5">
              <button onClick={() => cycleInstrument(-1)} className="press flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Previous">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => cycleInstrument(1)} className="press flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Next">
                <ChevronRight size={14} />
              </button>
            </span>
          </div>

          {/* Select Mode */}
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Select Mode</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <button className="rounded-md border border-primary-300 bg-primary-50 px-2 py-1.5 text-xs font-semibold text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
              Live
            </button>
            <button disabled className="cursor-not-allowed rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-400 dark:border-slate-700" title="Historical mode coming soon">
              Historical
            </button>
          </div>

          {/* Expiry */}
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Expiry</div>
          <select
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-[#0f1623] dark:text-slate-200"
          >
            {expiries.map((e, i) => (
              <option key={e.label} value={i}>{e.label} ({e.days === 0 ? 'today' : `${e.days}d`})</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Chart panel ──────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0a0e16]">
        {/* thin header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800 dark:text-slate-100">
            <LineChart size={15} className="text-primary-600" /> Future Price vs OI
          </h2>
          <LiveStatusClock />
        </div>

        {error && (
          <div className="px-3 pt-2">
            <ErrorBanner message={error} onRetry={refetch} />
          </div>
        )}

        {/* chart area — dominant; legend overlaid top-left */}
        <div className="relative min-h-0 flex-1">
          <div className="absolute left-2 top-1.5 z-10 flex items-center gap-3">
            <EyeToggle label="Price" color="#3b82f6" on={showPrice} onClick={() => setShowPrice((v) => !v)} />
            <EyeToggle label="OI" color="#9aa3b2" on={showOi} onClick={() => setShowOi((v) => !v)} />
          </div>

          {loading && !data ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : (
            <PriceVsOIChart
              price={data?.price_series ?? []}
              oi={data?.oi_series ?? []}
              showPrice={showPrice}
              showOi={showOi}
            />
          )}
          {refreshing && (
            <span className="absolute right-2 top-2 z-10 h-1.5 w-1.5 animate-pulse rounded-full bg-primary-500" title="Refreshing" />
          )}
        </div>
      </div>
    </div>
  )
}

function EyeToggle({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[11px] font-medium">
      {on ? <Eye size={13} className="text-slate-300" /> : <EyeOff size={13} className="text-slate-600" />}
      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: on ? color : '#475569' }} />
      <span className={on ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
    </button>
  )
}

function LiveStatusClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const label = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(now).replace(/\s?(am|pm)/i, (m) => m.toUpperCase())
  const open = isMarketOpenIST(now)
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
      <Clock size={12} />
      <span className="tabular-nums">{label}</span>
      <span className={cn('h-2 w-2 rounded-full', open ? 'bg-emerald-500' : 'bg-rose-500')} title={open ? 'Market open' : 'Market closed'} />
    </div>
  )
}
