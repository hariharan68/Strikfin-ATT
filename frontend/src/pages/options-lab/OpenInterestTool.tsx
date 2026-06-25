import { useMemo, useState } from 'react'
import { getOILabView, INSTRUMENTS } from '../../api/endpoints'
import type { OILabView } from '../../api/endpoints'
import type { InstrumentId } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { cn, formatNumber } from '../../lib/format'
import { Panel } from '../../components/ui/Panel'
import { LiveClock } from '../../components/ui/LiveClock'
import { ErrorBanner } from '../../components/ui/Page'
import { Skeleton } from '../../components/ui/Skeleton'
import { OpenInterestChart, fmtOI } from '../../components/options-lab/OpenInterestChart'
import type { OIBar, OIMode } from '../../components/options-lab/OpenInterestChart'

// ── Chart-mode tabs ────────────────────────────────────────────────
const MODE_TABS: { label: string; mode: OIMode }[] = [
  { label: 'OI Change+Total', mode: 'change_total' },
  { label: 'OI Change', mode: 'change' },
  { label: 'Total OI', mode: 'total' },
]

const STRIKE_FILTERS: { label: string; n: number | 'all' }[] = [
  { label: 'All', n: 'all' },
  { label: 'ATM', n: 2 },
  { label: '5', n: 5 },
  { label: '10', n: 10 },
  { label: '20', n: 20 },
]

const QUICK_RANGES = [
  'Last 3 min', 'Last 5 min', 'Last 10 min', 'Last 15 min',
  'Last 30 min', 'Last 1 hr', 'Last 2 hr', 'Last 3 hr', 'All',
]

// ── helpers ────────────────────────────────────────────────────────

/** Format an ISO timestamp as "9:15 AM" in IST. */
function fmtClock(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(d)
}

/** Upcoming weekly expiries (Tuesdays) for the expiry dropdown display. */
function upcomingExpiries(from: Date, count = 6) {
  const base = new Date(from)
  base.setHours(0, 0, 0, 0)
  const out: { label: string; days: number }[] = []
  const d = new Date(base)
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1)
  for (let i = 0; i < count; i++) {
    const days = Math.round((d.getTime() - base.getTime()) / 86_400_000)
    out.push({
      label: new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      }).format(d),
      days,
    })
    d.setDate(d.getDate() + 7)
  }
  return out
}

export function OpenInterestTool() {
  const [instrument, setInstrument] = useInstrument()
  const [mode, setMode] = useState<OIMode>('change_total')
  const [showLot, setShowLot] = useState(false)
  const [strikeFilter, setStrikeFilter] = useState<number | 'all'>(10)
  const [quickRange, setQuickRange] = useState('All')
  const [selectedExpiry, setSelectedExpiry] = useState(0)

  const { data, error, loading, refreshing, refetch } = useFetch<OILabView>(
    () => getOILabView(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const expiries = useMemo(() => upcomingExpiries(new Date()), [])
  const instLabel = INSTRUMENTS.find((x) => x.id === instrument)?.label ?? 'NIFTY 50'
  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'

  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  // ── derive bars (+ strike filter) ────────────────────────────────
  const allBars: OIBar[] = useMemo(
    () =>
      (data?.strikes ?? []).map((s) => ({
        strike: s.strike,
        callOpen: s.call_oi_open,
        callNow: s.call_oi_now,
        callChg: s.call_oi_chg,
        callChgPct: s.call_oi_chg_pct,
        putOpen: s.put_oi_open,
        putNow: s.put_oi_now,
        putChg: s.put_oi_chg,
        putChgPct: s.put_oi_chg_pct,
      })),
    [data],
  )

  const bars = useMemo(() => {
    if (strikeFilter === 'all' || !data) return allBars
    const atm = data.atm_strike
    const strikes = allBars.map((b) => b.strike).sort((a, b) => a - b)
    const step = strikes.length > 1 ? strikes[1] - strikes[0] : 50
    const lo = atm - strikeFilter * step
    const hi = atm + strikeFilter * step
    return allBars.filter((b) => b.strike >= lo && b.strike <= hi)
  }, [allBars, strikeFilter, data])

  const openLabel = fmtClock(data?.open_ts)
  const nowLabel = fmtClock(data?.now_ts)
  const lotSize = data?.lot_size ?? 75

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr]">
      {/* ── Settings sidebar ──────────────────────────────────────── */}
      <div className="space-y-5">
        <Panel className="p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Settings</h3>

          {/* Instrument selector */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
              {instrument === 1 ? '50' : 'BSE'}
            </span>
            <span className="text-sm font-bold text-slate-800">{instShort}</span>
            <span className="flex gap-1">
              <button
                onClick={() => cycleInstrument(-1)}
                className="press flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Previous instrument"
              >
                ‹
              </button>
              <button
                onClick={() => cycleInstrument(1)}
                className="press flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Next instrument"
              >
                ›
              </button>
            </span>
          </div>

          {/* Mode (Live / Historical) */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Select Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-lg border border-primary-300 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700">
                Live
              </button>
              <button
                disabled
                className="cursor-not-allowed rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
                title="Historical mode coming soon"
              >
                Historical
              </button>
            </div>
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
                <option key={e.label} value={i}>
                  {e.label} ({e.days === 0 ? 'today' : `${e.days}d`})
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              Live chain is served for the nearest expiry.
            </p>
          </div>

          {/* Strikes filter */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Strikes above-below ATM
            </div>
            <div className="flex gap-1.5">
              {STRIKE_FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => setStrikeFilter(f.n)}
                  className={cn(
                    'press flex-1 rounded-lg border px-1 py-1.5 text-xs font-semibold',
                    strikeFilter === f.n
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        {/* Market Sentiment */}
        <Panel className="p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">
            📊 Market Sentiment <span className="text-[11px] font-normal text-slate-400">(based on OI)</span>
          </h3>
          {loading || !data ? (
            <Skeleton className="mx-auto mt-3 h-40 w-40 rounded-full" />
          ) : (
            <>
              <SentimentDonut
                pct={data.sentiment.bullish_pct}
                label={data.sentiment.label}
              />
              <div className="mt-3 border-t border-slate-100 pt-3 text-center">
                <div className="text-sm">
                  <span className="font-semibold text-slate-600">PCR: </span>
                  <span className="font-bold text-slate-900">{formatNumber(data.pcr_oi, 2)}</span>
                  <span className={cn('ml-1 font-semibold', data.pcr_change >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    ({data.pcr_change >= 0 ? '+' : ''}{formatNumber(data.pcr_change, 2)})
                  </span>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">ⓘ Market Insight</div>
                <p className="mt-1 text-xs leading-snug text-slate-600">{data.sentiment.insight}</p>
              </div>
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">ⓘ Analysis</div>
                <p className="mt-1 text-xs leading-snug text-slate-500">{data.sentiment.analysis}</p>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ── Main chart + panels ───────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <Panel className="p-5">
          {/* Mode tabs + status row */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5">
              {MODE_TABS.map((t) => (
                <button
                  key={t.mode}
                  onClick={() => setMode(t.mode)}
                  className={cn(
                    'press rounded-lg border px-3 py-1.5 text-sm font-semibold',
                    mode === t.mode
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">Show Lot</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showLot}
                  onClick={() => setShowLot((v) => !v)}
                  className={cn('relative h-5 w-9 rounded-full transition-colors', showLot ? 'bg-primary-600' : 'bg-slate-300')}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                      showLot ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </label>
              <LiveClock refreshing={refreshing} />
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-[392px] w-full" />
          ) : bars.length === 0 ? (
            <div className="flex h-[392px] items-center justify-center text-sm text-slate-400">
              No option-chain data available yet.
            </div>
          ) : (
            <OpenInterestChart
              bars={bars}
              mode={mode}
              spot={data?.spot}
              atmStrike={data?.atm_strike}
              maxPain={data?.max_pain}
              lotSize={lotSize}
              showLot={showLot}
              openLabel={openLabel}
              nowLabel={nowLabel}
            />
          )}

          {/* Time range (session window) */}
          <div className="mt-5">
            <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
              <span>{openLabel}</span>
              <div className="relative h-1.5 flex-1 rounded-full bg-primary-500/30">
                <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-primary-500/60" />
                <span className="absolute -top-1 left-0 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-primary-600 bg-white" />
                <span className="absolute -top-1 right-0 h-3.5 w-3.5 translate-x-1/2 rounded-full border-2 border-primary-600 bg-white" />
              </div>
              <span>{nowLabel}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setQuickRange(r)}
                  className={cn(
                    'press rounded-lg border px-2.5 py-1.5 text-xs font-medium',
                    quickRange === r
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Showing OI build-up from {openLabel} to {nowLabel}
              {data?.data_quality === 'live_proxy' && ' (open estimated from day-over-day OI change until intraday history accrues)'}.
              Custom time-window comparison is coming soon.
            </p>
          </div>
        </Panel>

        {/* Bottom panels */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">📊 Open Interest Change</h3>
            {data && <BarPair call={data.total_call_oi_chg} put={data.total_put_oi_chg} showLot={showLot} lot={lotSize} signed />}
          </Panel>
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">📊 Total Open Interest</h3>
            {data && <BarPair call={data.total_call_oi} put={data.total_put_oi} showLot={showLot} lot={lotSize} />}
          </Panel>
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">📊 Put/Call Ratio</h3>
            {data && (
              <PcrDonut
                callOi={data.total_call_oi}
                putOi={data.total_put_oi}
                pcr={data.pcr_oi}
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function SentimentDonut({ pct, label }: { pct: number; label: string }) {
  const r = 56
  const c = 2 * Math.PI * r
  const filled = (pct / 100) * c
  const color = label === 'Bullish' ? '#16a34a' : label === 'Bearish' ? '#ef4444' : '#f59e0b'
  return (
    <div className="relative mx-auto mt-2 h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth="14" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold" style={{ color }}>{label}</span>
        <span className="px-6 text-[10px] leading-tight text-slate-400">{label} market conditions</span>
        <span className="mt-0.5 text-sm font-bold text-slate-700">{pct}%</span>
      </div>
    </div>
  )
}

function BarPair({
  call,
  put,
  showLot,
  lot,
  signed,
}: {
  call: number
  put: number
  showLot: boolean
  lot: number
  signed?: boolean
}) {
  const max = Math.max(1, Math.abs(call), Math.abs(put))
  const fmt = (n: number) => (signed && n > 0 ? '+' : '') + fmtOI(n, showLot, lot)
  return (
    <div className="flex h-44 items-end justify-around gap-6 pt-4">
      <Bar label="CALL" value={call} max={max} color="#16a34a" text={fmt(call)} />
      <Bar label="PUT" value={put} max={max} color="#ef4444" text={fmt(put)} />
    </div>
  )
}

function Bar({ label, value, max, color, text }: { label: string; value: number; max: number; color: string; text: string }) {
  const h = Math.max(4, (Math.abs(value) / max) * 120)
  return (
    <div className="flex flex-1 flex-col items-center">
      <span className="mb-1 text-xs font-bold text-slate-700">{text}</span>
      <div className="flex w-full max-w-[64px] flex-1 items-end">
        <div className="w-full rounded-t" style={{ height: h, background: color }} />
      </div>
      <span className="mt-1.5 text-xs font-semibold text-slate-500">{label}</span>
    </div>
  )
}

function PcrDonut({ callOi, putOi, pcr }: { callOi: number; putOi: number; pcr: number }) {
  const total = Math.max(1, callOi + putOi)
  const callPct = Math.round((callOi / total) * 100)
  const putPct = 100 - callPct
  const r = 52
  const c = 2 * Math.PI * r
  const callLen = (callPct / 100) * c
  return (
    <div className="relative mx-auto h-44 w-44">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#ef4444" strokeWidth="16" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke="#16a34a" strokeWidth="16"
          strokeDasharray={`${callLen} ${c - callLen}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-medium text-slate-400">PCR</span>
        <span className="text-xl font-bold text-slate-800">{formatNumber(pcr, 2)}</span>
      </div>
      <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-emerald-600">{callPct}%<br />Call OI</span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-right text-[11px] font-semibold text-rose-500">{putPct}%<br />Put OI</span>
    </div>
  )
}
