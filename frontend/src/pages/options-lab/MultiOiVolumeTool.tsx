import { useCallback, useMemo, useState } from 'react'
import { BarChart3, Check, Info, LineChart } from 'lucide-react'
import { getOILabSeries, INSTRUMENTS } from '../../api/endpoints'
import type { InstrumentId, OILabSeries } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { callPutColors, usePreferences } from '../../lib/usePreferences'
import { cn } from '../../lib/format'
import { Panel } from '../../components/ui/Panel'
import { LiveClock } from '../../components/ui/LiveClock'
import { ErrorBanner } from '../../components/ui/Page'
import { Skeleton } from '../../components/ui/Skeleton'
import { MultiLineChart } from '../../components/options-lab/MultiLineChart'
import type { LineSeries } from '../../components/options-lab/MultiLineChart'
import { fmtOI } from '../../components/options-lab/OpenInterestChart'

// Distinct line colors, assigned to selected contracts in order.
const PALETTE = [
  '#ec4899', // pink-500
  '#3b82f6', // blue-500
  '#eab308', // yellow-500
  '#22c55e', // green-500
  '#f97316', // orange-500
  '#a855f7', // purple-500
  '#06b6d4', // cyan-500
  '#ef4444', // red-500
  '#84cc16', // lime-500
  '#14b8a6', // teal-500
]

const HIGH_OI_COUNTS = [3, 5, 8, 10]
type Metric = 'oi' | 'vol'
type View = 'individual' | 'callput'

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

export function MultiOiVolumeTool() {
  const [instrument, setInstrument] = useInstrument()
  const { callPutScheme } = usePreferences()
  const [metric, setMetric] = useState<Metric>('oi')
  const [view, setView] = useState<View>('individual')
  const [highOi, setHighOi] = useState(5)
  const [highVol, setHighVol] = useState(5)
  const [selSource, setSelSource] = useState<'oi' | 'vol' | 'custom'>('oi')
  const [selected, setSelected] = useState<string[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [selectedExpiry, setSelectedExpiry] = useState(0)
  const [showCustom, setShowCustom] = useState(false)
  // Tracks which payload the default selection was seeded from (instrument+date).
  const [seededKey, setSeededKey] = useState<string | null>(null)

  const { data, error, loading, refreshing, refetch } = useFetch<OILabSeries>(
    () => getOILabSeries(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const expiries = useMemo(() => upcomingExpiries(new Date()), [])
  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'

  // Seed the "High OI" default selection SYNCHRONOUSLY the first time a payload
  // arrives (and whenever the instrument/date changes). Doing this during render
  // — instead of in an effect — means the chart mounts WITH its per-strike series
  // already present, rather than mounting empty (only the future line) and
  // relying on a follow-up update that didn't reliably back-fill until a metric
  // toggle. This is the React-sanctioned "adjust state when input changes" pattern
  // (the guard makes it run once per payload key, never looping).
  const seedKey = data ? `${data.instrument_id}:${data.trade_date}` : null
  if (seedKey && seedKey !== seededKey) {
    setSeededKey(seedKey)
    setSelected((data?.default_ids ?? []).slice(0, highOi))
  }

  // When a High-OI / High-Volume count changes, repopulate the selection from
  // the matching server-side ranking and remember which helper is active.
  const applyHighOi = (n: number) => {
    setHighOi(n)
    setSelSource('oi')
    if (data) setSelected(data.default_ids.slice(0, n))
  }
  const applyHighVol = (n: number) => {
    setHighVol(n)
    setSelSource('vol')
    if (data) setSelected(data.default_vol_ids.slice(0, n))
  }

  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  const contractById = useMemo(() => {
    const m = new Map<string, { id: string; strike: number; type: 'CE' | 'PE'; idx: number }>()
    data?.contracts.forEach((c, idx) => m.set(c.id, { ...c, idx }))
    return m
  }, [data])

  // Stable color per selected contract (by position in the selection).
  const colorFor = useMemo(() => {
    const m = new Map<string, string>()
    selected.forEach((id, i) => m.set(id, PALETTE[i % PALETTE.length]))
    return m
  }, [selected])

  const times = useMemo(() => data?.series.map((p) => p.t) ?? [], [data])
  const future = useMemo(() => data?.series.map((p) => p.fut) ?? [], [data])

  // Fixed x-axis over the full trading session (09:15–15:30 IST of the trade
  // date) so the chart always shows market hours and the curve builds
  // left-to-right as snapshots accrue — instead of stretching whatever slice
  // of the day has data across the whole width.
  const sessionStart = data?.trade_date ? `${data.trade_date}T09:15:00+05:30` : undefined
  const sessionEnd = data?.trade_date ? `${data.trade_date}T15:30:00+05:30` : undefined

  // Build the line series for a metric, honoring Individual / Call vs Put.
  // `valuesFor` walks the series once per contract; Call-vs-Put sums those
  // pre-extracted arrays rather than re-extracting inside the time loop.
  const buildSeries = useCallback(
    (m: 'oi' | 'vol' | 'chg'): LineSeries[] => {
      if (!data) return []
      const visible = selected.filter((id) => !hidden.has(id))
      const valuesFor = (idx: number) => data.series.map((p) => p[m][idx] ?? null)

      if (view === 'callput') {
        const sum = (type: 'CE' | 'PE'): (number | null)[] => {
          const arrs = visible
            .map((id) => contractById.get(id))
            .filter((c) => c?.type === type)
            .map((c) => valuesFor(c!.idx))
          if (arrs.length === 0) return data.series.map(() => null)
          return data.series.map((_, ti) => {
            let acc = 0
            let any = false
            for (const a of arrs) {
              const v = a[ti]
              if (v != null) { acc += v; any = true }
            }
            return any ? acc : null
          })
        }
        const lbl = m === 'oi' ? 'OI' : m === 'vol' ? 'Volume' : 'OI Change'
        const cp = callPutColors(callPutScheme)
        return [
          { key: 'CALL', label: `Total Call ${lbl}`, color: cp.call, values: sum('CE') },
          { key: 'PUT', label: `Total Put ${lbl}`, color: cp.put, values: sum('PE') },
        ]
      }

      return visible.flatMap((id) => {
        const c = contractById.get(id)
        if (!c) return []
        return [{ key: id, label: `${c.strike} ${c.type}`, color: colorFor.get(id) ?? '#64748b', values: valuesFor(c.idx) }]
      })
    },
    [data, selected, hidden, view, contractById, colorFor, callPutScheme],
  )

  // Per-series show/hide now lives in each chart's ECharts legend
  // (click-to-toggle, Future included) — no external eye-toggle state.
  const oiSeriesAll = useMemo(() => buildSeries(metric), [buildSeries, metric])
  const chgSeriesAll = useMemo(() => buildSeries('chg'), [buildSeries])

  // CALL/PUT totals at the latest snapshot across the whole strike window —
  // powers the summary bar panels (mirrors the reference UI's bottom cards).
  const totals = useMemo(() => {
    if (!data || data.series.length === 0 || data.contracts.length === 0) return null
    const last = data.series[data.series.length - 1]
    let callOi = 0, putOi = 0, callChg = 0, putChg = 0
    data.contracts.forEach((c, i) => {
      const oi = last.oi[i] ?? 0
      const chg = last.chg[i] ?? 0
      if (c.type === 'CE') { callOi += oi; callChg += chg }
      else { putOi += oi; putChg += chg }
    })
    return { callOi, putOi, callChg, putChg }
  }, [data])

  const lotSize = data?.lot_size ?? 75
  const callList = data?.contracts.filter((c) => c.type === 'CE') ?? []
  const putList = data?.contracts.filter((c) => c.type === 'PE') ?? []

  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleSelected = (id: string) => {
    setSelSource('custom')
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr]">
      {/* ── Settings sidebar ──────────────────────────────────────── */}
      <div className="space-y-5">
        <Panel className="p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Settings</h3>

          {/* Instrument */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
              {instrument === 1 ? '50' : 'BSE'}
            </span>
            <span className="text-sm font-bold text-slate-800">{instShort}</span>
            <span className="flex gap-1">
              <button onClick={() => cycleInstrument(-1)} className="press flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Previous instrument">‹</button>
              <button onClick={() => cycleInstrument(1)} className="press flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Next instrument">›</button>
            </span>
          </div>

          {/* Live / Historical */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="rounded-lg border border-primary-300 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700">Live</button>
            <button disabled className="cursor-not-allowed rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400" title="Historical mode coming soon">Historical</button>
          </div>

          {/* Expiry */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Expiry</div>
            <select
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400"
            >
              {expiries.map((e, i) => (
                <option key={e.label} value={i}>{e.label} ({e.days === 0 ? 'today' : `${e.days}d`})</option>
              ))}
            </select>
          </div>
        </Panel>

        {/* High Volume — top strikes by traded volume */}
        <Panel className="p-4">
          <SourceHeader
            title="High Volume"
            active={selSource === 'vol'}
            count={highVol}
            onCount={applyHighVol}
            onSelect={() => applyHighVol(highVol)}
          />
          {selSource === 'vol' &&
            (loading || !data ? (
              <Skeleton className="mt-3 h-24 w-full" />
            ) : (
              <ChipGrid ids={selected} contractById={contractById} hidden={hidden} colorFor={colorFor} onToggle={toggleHidden} />
            ))}
        </Panel>

        {/* High OI — top strikes by open interest */}
        <Panel className="p-4">
          <SourceHeader
            title="High OI"
            active={selSource === 'oi'}
            count={highOi}
            onCount={applyHighOi}
            onSelect={() => applyHighOi(highOi)}
          />
          {selSource === 'oi' &&
            (loading || !data ? (
              <Skeleton className="mt-3 h-24 w-full" />
            ) : (
              <ChipGrid ids={selected} contractById={contractById} hidden={hidden} colorFor={colorFor} onToggle={toggleHidden} />
            ))}
        </Panel>

        {/* Custom strikes — manual picker */}
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              Custom Strikes
              {selSource === 'custom' && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" title="Active selection" />}
            </h3>
            <button
              onClick={() => setShowCustom((v) => !v)}
              className="press rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50"
            >
              {showCustom ? 'Close' : 'Select'}
            </button>
          </div>
          {showCustom && data && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StrikeColumn title="Calls" list={callList} selected={selected} onToggle={toggleSelected} />
              <StrikeColumn title="Puts" list={putList} selected={selected} onToggle={toggleSelected} />
            </div>
          )}
          {selSource === 'custom' && !showCustom && (
            <ChipGrid ids={selected} contractById={contractById} hidden={hidden} colorFor={colorFor} onToggle={toggleHidden} />
          )}
        </Panel>
      </div>

      {/* ── Charts ────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {/* Section 1 — Multi OI & Volume */}
        <Panel className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><LineChart size={18} className="text-primary-600" /> Multi OI &amp; Volume</h2>
              <Segmented
                options={[{ k: 'oi', label: 'OI' }, { k: 'vol', label: 'Volume' }]}
                value={metric}
                onChange={(k) => setMetric(k as Metric)}
              />
              <Segmented
                options={[{ k: 'individual', label: 'Individual' }, { k: 'callput', label: 'Call vs Put' }]}
                value={view}
                onChange={(k) => setView(k as View)}
              />
            </div>
            <LiveClock refreshing={refreshing} />
          </div>

          {loading || !data ? (
            <Skeleton className="h-[340px] w-full" />
          ) : (
            <>
              <MultiLineChart times={times} series={oiSeriesAll} future={future} lotSize={lotSize} showLot={false} domainStart={sessionStart} domainEnd={sessionEnd} />
              <p className="mt-2 text-[11px] leading-snug text-slate-400">
                Intraday {metric === 'oi' ? 'open interest' : 'volume'} per strike across the 9:15 am – 3:30 pm session
                (data from {fmtClock(data.open_ts)} to {fmtClock(data.now_ts)})
                {data.data_quality === 'live_proxy' && ' — single live snapshot; the curve builds as the session runs'}.
                Dashed line is the future price. Drag to pan · scroll to zoom · double-click to reset.
              </p>
            </>
          )}
        </Panel>

        {/* Section 2 — MultiStrike OI Change */}
        <Panel className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><LineChart size={18} className="text-primary-600" /> MultiStrike OI Change</h2>
            <LiveClock refreshing={refreshing} />
          </div>

          {loading || !data ? (
            <Skeleton className="h-[340px] w-full" />
          ) : (
            <>
              <MultiLineChart times={times} series={chgSeriesAll} future={future} lotSize={lotSize} showLot={false} signed domainStart={sessionStart} domainEnd={sessionEnd} />
              <p className="mt-2 text-[11px] leading-snug text-slate-400">
                Intraday OI change (vs the day's open) per strike. Rising = fresh writing, falling = unwinding.
              </p>
            </>
          )}
        </Panel>

        {/* Section 3 — CALL vs PUT summary bars (whole strike window, latest snapshot) */}
        {!loading && data && totals && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Panel className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <BarChart3 size={18} className="text-primary-600" /> Open Interest Change
                  <span title="Day change in open interest, calls vs puts, summed across the strike window."><Info size={14} className="text-slate-400" /></span>
                </h2>
              </div>
              <CallPutBars call={totals.callChg} put={totals.putChg} signed />
            </Panel>
            <Panel className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <BarChart3 size={18} className="text-primary-600" /> Total Open Interest
                  <span title="Outstanding open interest, calls vs puts, summed across the strike window."><Info size={14} className="text-slate-400" /></span>
                </h2>
              </div>
              <CallPutBars call={totals.callOi} put={totals.putOi} />
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}

// ── helpers / sub-components ───────────────────────────────────────

function fmtClock(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(d)
}

/** Header for a selection source: a count dropdown when active, else a Select button. */
function SourceHeader({
  title,
  active,
  count,
  onCount,
  onSelect,
}: {
  title: string
  active: boolean
  count: number
  onCount: (n: number) => void
  onSelect: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        {title}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" title="Active selection" />}
      </h3>
      {active ? (
        <select
          value={count}
          onChange={(e) => onCount(Number(e.target.value))}
          className="rounded-lg border border-primary-300 bg-white px-2 py-1 text-sm font-semibold text-primary-700 outline-none focus:border-primary-400"
        >
          {HIGH_OI_COUNTS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      ) : (
        <button
          onClick={onSelect}
          className="press rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50"
        >
          Select
        </button>
      )}
    </div>
  )
}

/** Colored, toggle-to-hide chips for the currently selected strikes. */
function ChipGrid({
  ids,
  contractById,
  hidden,
  colorFor,
  onToggle,
}: {
  ids: string[]
  contractById: Map<string, { id: string; strike: number; type: 'CE' | 'PE'; idx: number }>
  hidden: Set<string>
  colorFor: Map<string, string>
  onToggle: (id: string) => void
}) {
  if (ids.length === 0) return <p className="mt-3 text-xs text-slate-400">No strikes selected.</p>
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5">
      {ids.map((id) => {
        const c = contractById.get(id)
        if (!c) return null
        const off = hidden.has(id)
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            className={cn(
              'press flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold',
              off ? 'border-slate-200 text-slate-400' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
            )}
            title={off ? 'Click to show' : 'Click to hide'}
          >
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: off ? 'var(--color-slate-300)' : colorFor.get(id) }} />
            {c.strike} {c.type}
          </button>
        )
      })}
    </div>
  )
}

function Segmented({ options, value, onChange }: { options: { k: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={cn(
            'press rounded-md px-3 py-1 text-sm font-semibold transition-colors',
            value === o.k ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Two-bar CALL vs PUT summary (green/red) with compact value labels, matching
 * the reference UI's bottom cards. `signed` keeps the +/− prefix on labels for
 * the OI-change card; bar heights use magnitudes so unwinding still shows.
 */
function CallPutBars({ call, put, signed }: { call: number; put: number; signed?: boolean }) {
  const max = Math.max(Math.abs(call), Math.abs(put), 1)
  const AREA = 180 // px reserved for label + bar
  const fmt = (v: number) => (signed && v > 0 ? '+' : '') + fmtOI(v, false, 1)
  const bar = (label: string, v: number, color: string) => (
    <div className="flex flex-1 flex-col items-center">
      <div className="flex w-full max-w-[150px] flex-col justify-end" style={{ height: AREA }}>
        <div className="mb-1 text-center text-sm font-bold text-slate-700">{fmt(v)}</div>
        <div
          className="w-full rounded-t-md"
          style={{ background: color, height: Math.max(6, (Math.abs(v) / max) * (AREA - 30)) }}
        />
      </div>
      <div className="mt-2 w-full border-t border-slate-200 pt-2 text-center text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
  return (
    <div className="flex items-end gap-6 px-4">
      {bar('Call', call, '#22c55e')}
      {bar('Put', put, '#f87171')}
    </div>
  )
}

function StrikeColumn({
  title,
  list,
  selected,
  onToggle,
}: {
  title: string
  list: { id: string; strike: number; type: 'CE' | 'PE' }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {list.map((c) => {
          const on = selected.includes(c.id)
          return (
            <button
              key={c.id}
              onClick={() => onToggle(c.id)}
              className={cn(
                'press flex w-full items-center justify-between rounded-md border px-2 py-1 text-xs font-medium',
                on ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              {c.strike}
              {on && <Check size={13} className="text-primary-500" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
