import { useMemo, useState } from 'react'
import { Activity, BarChart3, Scale, TrendingUp } from 'lucide-react'
import { getPcrSeries, INSTRUMENTS } from '../../api/endpoints'
import type { InstrumentId, PcrSeries, PcrSeriesPoint } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { callPutColors, usePreferences } from '../../lib/usePreferences'
import { cn, fmtExpiry } from '../../lib/format'
import { Panel } from '../../components/ui/Panel'
import { LiveClock } from '../../components/ui/LiveClock'
import { ErrorBanner } from '../../components/ui/Page'
import { Skeleton } from '../../components/ui/Skeleton'
import { MultiLineChart } from '../../components/options-lab/MultiLineChart'
import type { LineSeries } from '../../components/options-lab/MultiLineChart'

const PCR_COLOR = '#3b82f6' // blue-500

const TIMEFRAMES: { label: string; minutes: number }[] = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
]

const r2 = (v: number) => v.toFixed(2)

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

/**
 * Bucket the series to the chosen timeframe (last point per bucket), always
 * anchoring the first (09:15 open) and last (now/close) points. Snapshots are
 * already ~5 min apart, so 5m is a pass-through.
 */
function resample(series: PcrSeriesPoint[], minutes: number): PcrSeriesPoint[] {
  if (minutes <= 5 || series.length <= 2) return series
  const ms = minutes * 60_000
  const byBucket = new Map<number, PcrSeriesPoint>()
  for (const p of series) byBucket.set(Math.floor(new Date(p.t).getTime() / ms), p)
  const out = [...byBucket.values()]
  if (out.length < 2) return series
  out[0] = series[0]
  out[out.length - 1] = series[series.length - 1]
  return out
}

export function PutCallRatioTool() {
  const [instrument, setInstrument] = useInstrument()
  const [timeframe, setTimeframe] = useState(5)
  const { callPutScheme } = usePreferences()
  const cp = callPutColors(callPutScheme)

  const { data, error, loading, refreshing, refetch } = useFetch<PcrSeries>(
    () => getPcrSeries(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'
  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  const points = useMemo(() => resample(data?.series ?? [], timeframe), [data, timeframe])
  const times = useMemo(() => points.map((p) => p.t), [points])
  const future = useMemo(() => points.map((p) => p.fut), [points])

  const sessionStart = data?.trade_date ? `${data.trade_date}T09:15:00+05:30` : undefined
  const sessionEnd = data?.trade_date ? `${data.trade_date}T15:30:00+05:30` : undefined
  const lotSize = data?.lot_size ?? 1

  // Header: latest PCR + sentiment read (OI-based: high PCR ⇒ put writing ⇒ bullish).
  const latest = points[points.length - 1]
  const pcr = latest?.pcr ?? null
  const regime = pcr == null ? 'neutral' : pcr >= 1.1 ? 'bullish' : pcr <= 0.9 ? 'bearish' : 'neutral'
  const regimeColor = regime === 'bullish' ? cp.call : regime === 'bearish' ? cp.put : '#64748b'

  const pcrSeries: LineSeries[] = useMemo(
    () => [{ key: 'pcr', label: 'Put Call Ratio', color: PCR_COLOR, values: points.map((p) => p.pcr) }],
    [points],
  )
  const oiChgSeries: LineSeries[] = useMemo(
    () => [
      { key: 'call', label: 'Call OI Change', color: cp.call, values: points.map((p) => p.call_oi_chg) },
      { key: 'put', label: 'Put OI Change', color: cp.put, values: points.map((p) => p.put_oi_chg) },
    ],
    [points, cp.call, cp.put],
  )
  const totalOiSeries: LineSeries[] = useMemo(
    () => [
      { key: 'call', label: 'Call OI', color: cp.call, values: points.map((p) => p.call_oi) },
      { key: 'put', label: 'Put OI', color: cp.put, values: points.map((p) => p.put_oi) },
    ],
    [points, cp.call, cp.put],
  )

  const empty = !loading && data?.data_quality === 'empty'
  const proxyNote =
    data?.data_quality === 'live_proxy'
      ? ' — single live snapshot; the curve builds as the session runs'
      : ''

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

          {/* Expiry (nearest — the expiry the snapshots track) */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Expiry</div>
            <select
              value={0}
              onChange={() => {}}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400"
            >
              <option value={0}>{fmtExpiry(data?.expiry_date ?? null)}</option>
            </select>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              Live chain is served for the nearest expiry.
            </p>
          </div>

          {/* Timeframe */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Timeframe</div>
            <div className="flex gap-1.5">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.minutes}
                  onClick={() => setTimeframe(t.minutes)}
                  className={cn(
                    'press flex-1 rounded-lg border px-1 py-1.5 text-xs font-semibold',
                    timeframe === t.minutes
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        {/* PCR summary */}
        <Panel className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Scale size={16} className="text-slate-400" /> Put-Call Ratio
          </h3>
          {loading || !data ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold text-slate-900">{pcr != null ? pcr.toFixed(2) : '—'}</span>
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
                  style={{ color: regimeColor, background: `${regimeColor}1a` }}
                >
                  {regime}
                </span>
              </div>
              <p className="text-xs leading-snug text-slate-500">
                PCR &gt; 1 skews to put writing (support/bullish); &lt; 1 skews to call writing
                (resistance/bearish).
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Charts ────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <ChartPanel title="Put-Call Ratio" Icon={Scale} refreshing={refreshing}>
          {loading || !data ? (
            <Skeleton className="h-[300px] w-full" />
          ) : empty ? (
            <EmptyNote />
          ) : (
            <>
              <MultiLineChart
                times={times}
                series={pcrSeries}
                future={future}
                lotSize={lotSize}
                showLot={false}
                valueFmt={r2}
                domainStart={sessionStart}
                domainEnd={sessionEnd}
                height={300}
              />
              <Caption text={`Intraday Put-Call Ratio vs the future price${proxyNote}.`} data={data} />
            </>
          )}
        </ChartPanel>

        <ChartPanel title="OI Change (Call vs Put)" Icon={TrendingUp} refreshing={refreshing}>
          {loading || !data ? (
            <Skeleton className="h-[300px] w-full" />
          ) : empty ? (
            <EmptyNote />
          ) : (
            <>
              <MultiLineChart
                times={times}
                series={oiChgSeries}
                future={future}
                lotSize={lotSize}
                showLot={false}
                signed
                domainStart={sessionStart}
                domainEnd={sessionEnd}
                height={300}
              />
              <Caption text={`Day-over-day Call vs Put OI change${proxyNote}.`} data={data} />
            </>
          )}
        </ChartPanel>

        <ChartPanel title="Total OI (Call vs Put)" Icon={BarChart3} refreshing={refreshing}>
          {loading || !data ? (
            <Skeleton className="h-[300px] w-full" />
          ) : empty ? (
            <EmptyNote />
          ) : (
            <>
              <MultiLineChart
                times={times}
                series={totalOiSeries}
                future={future}
                lotSize={lotSize}
                showLot={false}
                domainStart={sessionStart}
                domainEnd={sessionEnd}
                height={300}
              />
              <Caption text={`Chain-wide total Call vs Put OI${proxyNote}.`} data={data} />
            </>
          )}
        </ChartPanel>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function ChartPanel({
  title,
  Icon,
  refreshing,
  children,
}: {
  title: string
  Icon: typeof Scale
  refreshing: boolean
  children: React.ReactNode
}) {
  return (
    <Panel className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Icon size={16} className="text-primary-500" /> {title}
        </h3>
        <LiveClock refreshing={refreshing} />
      </div>
      {children}
    </Panel>
  )
}

function Caption({ text, data }: { text: string; data: PcrSeries }) {
  return (
    <p className="mt-2 text-[11px] leading-snug text-slate-400">
      {text} Data from {fmtClock(data.open_ts)} to {fmtClock(data.now_ts)}. Dashed line is the future
      price. Drag to pan · scroll to zoom · double-click to reset.
    </p>
  )
}

function EmptyNote() {
  return (
    <div className="flex h-[300px] items-center justify-center px-8 text-center text-sm text-slate-400">
      <Activity size={16} className="mr-2 text-slate-300" /> No option-chain data available yet.
    </div>
  )
}
