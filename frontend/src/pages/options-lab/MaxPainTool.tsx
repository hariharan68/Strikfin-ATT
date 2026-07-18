import { useMemo, useState } from 'react'
import { Activity, Flame } from 'lucide-react'
import { getOILabView, INSTRUMENTS } from '../../api/endpoints'
import type { InstrumentId, OILabView } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { cn, fmtExpiry, formatNumber } from '../../lib/format'
import { computePainCurve, maxPainStrike, maxPainSentiment } from '../../lib/maxpain'
import { Panel } from '../../components/ui/Panel'
import { LiveClock } from '../../components/ui/LiveClock'
import { ErrorBanner } from '../../components/ui/Page'
import { Skeleton } from '../../components/ui/Skeleton'
import { MaxPainChart } from '../../components/options-lab/MaxPainChart'

const STRIKE_FILTERS: { label: string; n: number | 'all' }[] = [
  { label: 'All', n: 'all' },
  { label: '5', n: 5 },
  { label: '10', n: 10 },
  { label: '20', n: 20 },
]

/** Format a snapshot ISO timestamp as "12:44 PM" in IST. */
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

export function MaxPainTool() {
  const [instrument, setInstrument] = useInstrument()
  const [strikeFilter, setStrikeFilter] = useState<number | 'all'>(10)

  const { data, error, loading, refreshing, refetch } = useFetch<OILabView>(
    () => getOILabView(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'
  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  // Pain curve over the FULL chain (max pain must not move with the strike filter).
  const curve = useMemo(() => {
    if (!data) return []
    return computePainCurve(
      data.strikes.map((s) => s.strike),
      data.strikes.map((s) => s.call_oi_now),
      data.strikes.map((s) => s.put_oi_now),
    )
  }, [data])

  // Client-side argmin so the pill lines up with the plotted minimum bar; the
  // payload's max_pain is the fallback.
  const mpStrike = useMemo(() => maxPainStrike(curve) ?? data?.max_pain ?? null, [curve, data])
  const spot = data?.spot ?? 0
  const sentiment = useMemo(
    () => maxPainSentiment(spot, mpStrike ?? 0),
    [spot, mpStrike],
  )

  // Trim the CHART to a window centered on the ATM index (symmetric strike-count,
  // reused from Gamma Exposure). Max pain / sentiment stay on the full curve.
  const chartBars = useMemo(() => {
    if (!data || curve.length === 0) return curve
    const atm = data.atm_strike
    const strikes = curve.map((r) => r.strike)
    let atmIdx = strikes.indexOf(atm)
    if (atmIdx < 0) {
      atmIdx = strikes.reduce(
        (best, s, i) => (Math.abs(s - atm) < Math.abs(strikes[best] - atm) ? i : best),
        0,
      )
    }
    const avail = Math.min(atmIdx, strikes.length - 1 - atmIdx)
    const half = strikeFilter === 'all' ? avail : Math.min(strikeFilter, avail)
    return curve.slice(atmIdx - half, atmIdx + half + 1)
  }, [curve, strikeFilter, data])

  const empty = !loading && data?.data_quality === 'empty'
  const snapLabel = fmtClock(data?.now_ts)

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr]">
      {/* ── Settings sidebar ──────────────────────────────────────── */}
      <div className="space-y-5">
        <Panel className="p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Settings</h3>

          {/* Instrument selector */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
              {INSTRUMENTS.find((x) => x.id === instrument)?.badge ?? '50'}
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

          {/* Expiry (nearest) */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Expiry</div>
            <select
              value={0}
              onChange={() => {}}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400"
            >
              <option value={0}>{fmtExpiry(data?.expiry_date ?? null)}</option>
            </select>
          </div>

          {/* Strikes filter */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Strikes above and below ATM
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
      </div>

      {/* ── Main ──────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <Panel className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
              <Flame size={18} className="text-primary-500" /> Max Pain
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Activity size={13} className="text-slate-400" />
                Snapshot: <span className="font-semibold text-slate-700">{snapLabel}</span>
              </div>
              <LiveClock refreshing={refreshing} />
            </div>
          </div>

          {loading || !data ? (
            <Skeleton className="h-[392px] w-full" />
          ) : empty || chartBars.length === 0 ? (
            <div className="flex h-[392px] items-center justify-center px-8 text-center text-sm text-slate-400">
              No option-chain data available yet.
            </div>
          ) : (
            <MaxPainChart
              bars={chartBars}
              spot={data.spot}
              atmStrike={data.atm_strike}
              maxPain={mpStrike}
            />
          )}
        </Panel>

        {/* Market Sentiment (based on Max Pain) */}
        <Panel className="p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Flame size={16} className="text-primary-500" /> Market Sentiment
            <span className="text-xs font-medium text-slate-400">(based on Max Pain)</span>
          </h3>
          {loading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[240px_1fr]">
              <MaxPainDonut sentiment={sentiment} />
              <div className="space-y-4">
                <Readout label="Max Pain Strike" value={mpStrike != null ? formatNumber(mpStrike, 2) : '—'} />
                <div className="h-px bg-slate-100" />
                <Readout label="Spot Price" value={formatNumber(spot, 2)} />
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-xs font-bold text-slate-700">Market Insight</div>
                  <p className="mt-1 text-xs leading-snug text-slate-500">{sentiment.insight}</p>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

const REGIME_META = {
  bullish: { label: 'Bullish', color: '#16a34a', sub: 'Spot above Max Pain' },
  bearish: { label: 'Bearish', color: '#ef4444', sub: 'Spot below Max Pain' },
  neutral: { label: 'Neutral', color: '#f59e0b', sub: 'Spot near Max Pain' },
} as const

function MaxPainDonut({
  sentiment,
}: {
  sentiment: { regime: 'bullish' | 'bearish' | 'neutral'; bullishPct: number }
}) {
  const meta = REGIME_META[sentiment.regime]
  const r = 56
  const c = 2 * Math.PI * r
  const filled = (sentiment.bullishPct / 100) * c
  return (
    <div className="relative mx-auto h-44 w-44">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={meta.color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-lg font-bold" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="mt-0.5 text-[10px] leading-tight text-slate-400">{meta.sub}</span>
      </div>
    </div>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="text-lg font-bold text-slate-900">{value}</span>
    </div>
  )
}
