import { useMemo, useState } from 'react'
import { Activity, Crosshair } from 'lucide-react'
import { getGexSeries, INSTRUMENTS } from '../../api/endpoints'
import type { GexSeries, InstrumentId } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { callPutColors, usePreferences } from '../../lib/usePreferences'
import { cn, fmtExpiry } from '../../lib/format'
import {
  aggregate,
  computeNetGexCross,
  computeStrikeGEX,
  computeWalls,
  computeZeroGamma,
  gexRegime,
  toCrore,
  yearsToExpiry,
  type GexStrikeInput,
} from '../../lib/gex'
import { Panel } from '../../components/ui/Panel'
import { LiveClock } from '../../components/ui/LiveClock'
import { ErrorBanner } from '../../components/ui/Page'
import { Skeleton } from '../../components/ui/Skeleton'
import { GexChart, fmtCr } from '../../components/options-lab/GexChart'
import type { GexChartMode } from '../../components/options-lab/GexChart'

const MODE_TABS: { label: string; mode: GexChartMode }[] = [
  { label: 'Net-Abs GEX', mode: 'net_abs' },
  { label: 'Call vs Put', mode: 'call_put' },
]

const STRIKE_FILTERS: { label: string; n: number | 'all' }[] = [
  { label: 'All', n: 'all' },
  { label: '5', n: 5 },
  { label: '10', n: 10 },
  { label: '20', n: 20 },
]

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

export function GammaExposureTool() {
  const [instrument, setInstrument] = useInstrument()
  const [mode, setMode] = useState<GexChartMode>('net_abs')
  // Default to a centered ±10-strike window (symmetric around ATM) so the chart
  // opens centered on spot; All/5/20 stay adjustable.
  const [strikeFilter, setStrikeFilter] = useState<number | 'all'>(10)
  const [showWalls, setShowWalls] = useState(true)
  const [showFlip, setShowFlip] = useState(true)
  // Time slider: null = follow the live/last snapshot.
  const [snapIdx, setSnapIdx] = useState<number | null>(null)
  const { callPutScheme } = usePreferences()
  const cp = callPutColors(callPutScheme)

  const { data, error, loading, refreshing, refetch } = useFetch<GexSeries>(
    () => getGexSeries(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const instShort = INSTRUMENTS.find((x) => x.id === instrument)?.short ?? 'NIFTY'
  const cycleInstrument = (dir: 1 | -1) => {
    const ids = INSTRUMENTS.map((x) => x.id)
    const idx = ids.indexOf(instrument)
    setInstrument(ids[(idx + dir + ids.length) % ids.length] as InstrumentId)
  }

  // ── time slider selection ────────────────────────────────────────
  const series = data?.series ?? []
  const hasSeries = series.length >= 2
  const lastIdx = Math.max(0, series.length - 1)
  const effIdx = series.length ? Math.min(snapIdx ?? lastIdx, lastIdx) : 0
  const point = series[effIdx]

  // ── GEX derivation (pure math from src/lib/gex.ts) ───────────────
  // Computed over the FULL payload window; the strike filter below only trims
  // what the chart displays — key levels and totals must not move with zoom.
  // Raw per-strike inputs (+ time-to-expiry) shared by the GEX aggregate and the
  // zero-gamma solver (which recomputes gamma at candidate spots).
  const { rawRows, tYears } = useMemo(() => {
    if (!data || !point || !data.expiry_ts) return { rawRows: [] as GexStrikeInput[], tYears: 0 }
    const rows: GexStrikeInput[] = data.strikes.map((strike, i) => ({
      strike,
      call: { oi: point.c_oi[i], iv: point.c_iv[i] },
      put: { oi: point.p_oi[i], iv: point.p_iv[i] },
    }))
    return { rawRows: rows, tYears: yearsToExpiry(point.t, data.expiry_ts) }
  }, [data, point])

  const strikeGex = useMemo(() => {
    if (!data || !point || rawRows.length === 0) return []
    return computeStrikeGEX(rawRows, point.spot, data.lot_size, tYears, data.risk_free)
  }, [rawRows, tYears, data, point])

  const totals = useMemo(() => aggregate(strikeGex), [strikeGex])
  const walls = useMemo(() => computeWalls(strikeGex), [strikeGex])
  // Gamma Flip = zero-gamma SPOT (recomputed gamma); Net GEX Cross = per-strike
  // net profile zero-cross near spot. Both computed on the full payload window.
  const gammaFlip = useMemo(() => {
    if (!data || rawRows.length === 0) return null
    return computeZeroGamma(rawRows, data.lot_size, tYears, data.risk_free)
  }, [rawRows, tYears, data])
  const netGexCross = useMemo(() => computeNetGexCross(strikeGex, point?.spot), [strikeGex, point])
  const regime = gexRegime(totals.netGEX)

  // Trim the chart to a window CENTERED on the ATM index — equal strike count on
  // each side — so the ATM/spot always sits mid-chart. Because the backend payload
  // is edge-clamped (asymmetric when ATM is near the chain edge), filtering by a
  // symmetric price range would leave one side short and push ATM off-center; here
  // we cap the half-width to what's available on the SHORTER side. 'all' uses that
  // full symmetric span. Walls/flip/totals stay on the untrimmed strikeGex.
  const chartRows = useMemo(() => {
    if (!data || strikeGex.length === 0) return strikeGex
    const atm = data.atm_strike
    const strikes = strikeGex.map((r) => r.strike)
    let atmIdx = strikes.indexOf(atm)
    if (atmIdx < 0) {
      atmIdx = strikes.reduce(
        (best, s, i) => (Math.abs(s - atm) < Math.abs(strikes[best] - atm) ? i : best),
        0,
      )
    }
    const avail = Math.min(atmIdx, strikes.length - 1 - atmIdx)
    const half = strikeFilter === 'all' ? avail : Math.min(strikeFilter, avail)
    return strikeGex.slice(atmIdx - half, atmIdx + half + 1)
  }, [strikeGex, strikeFilter, data])

  const snapLabel = fmtClock(point?.t ?? data?.now_ts)
  const netCr = toCrore(totals.netGEX)
  const absCr = toCrore(totals.absGEX)
  const longGamma = regime === 'long-gamma'

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

          {/* Expiry (nearest only — the expiry the snapshots track) */}
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
              GEX is computed for the nearest expiry — the only expiry with intraday snapshots.
            </p>
          </div>

          {/* Chart type */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Chart Type</div>
            <div className="grid grid-cols-2 gap-2">
              {MODE_TABS.map((t) => (
                <button
                  key={t.mode}
                  onClick={() => setMode(t.mode)}
                  className={cn(
                    'press rounded-lg border px-2 py-2 text-sm font-semibold',
                    mode === t.mode
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
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

          {/* Overlay toggles */}
          <div className="mt-4 space-y-2.5">
            <Toggle label="Show Walls" checked={showWalls} onChange={setShowWalls} />
            <Toggle label="Show Flip" checked={showFlip} onChange={setShowFlip} />
          </div>
        </Panel>

        {/* Key levels */}
        <Panel className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Crosshair size={16} className="text-slate-400" /> Key Levels
          </h3>
          {loading || !data ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <div className="space-y-2 text-sm">
              <LevelRow
                label="Call Wall"
                color={cp.call}
                value={walls.callWall != null ? String(walls.callWall) : '—'}
                hint="Max positive net GEX — upside pin/resistance"
              />
              <LevelRow
                label="Put Wall"
                color={cp.put}
                value={walls.putWall != null ? String(walls.putWall) : '—'}
                hint="Most negative net GEX — downside magnet/support"
              />
              <LevelRow
                label="Gamma Flip"
                color="#06b6d4"
                value={gammaFlip != null ? String(Math.round(gammaFlip)) : '—'}
                hint="Zero-gamma spot — dealer gamma flips long↔short"
              />
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div
                  className="text-xs font-bold"
                  style={{ color: longGamma ? cp.call : cp.put }}
                >
                  {longGamma ? 'Long gamma' : 'Short gamma'} regime
                </div>
                <p className="mt-1 text-xs leading-snug text-slate-500">
                  {longGamma
                    ? 'Dealers hedge against the move — volatility dampening, price tends to pin between the walls.'
                    : 'Dealers hedge with the move — volatility accelerating, moves can extend past the walls.'}
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Main chart ────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <Panel className="p-5">
          {/* Header: totals + status */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net GEX</div>
                <div className="text-lg font-bold" style={{ color: netCr >= 0 ? cp.call : cp.put }}>
                  {netCr > 0 ? '+' : ''}{fmtCr(netCr)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">ABS GEX</div>
                <div className="text-lg font-bold text-slate-800">{fmtCr(absCr)}</div>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{
                  color: longGamma ? cp.call : cp.put,
                  background: `${longGamma ? cp.call : cp.put}1a`,
                }}
              >
                {longGamma ? 'LONG GAMMA' : 'SHORT GAMMA'}
              </span>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Activity size={13} className="text-slate-400" />
                Snapshot: <span className="font-semibold text-slate-700">{snapLabel}</span>
              </div>
            </div>
            <LiveClock refreshing={refreshing} />
          </div>

          {loading ? (
            <Skeleton className="h-[392px] w-full" />
          ) : chartRows.length === 0 ? (
            <div className="flex h-[392px] items-center justify-center px-8 text-center text-sm text-slate-400">
              {strikeGex.length === 0 && (data?.series?.length ?? 0) > 0
                ? 'No IV available for this snapshot yet — GEX needs recoverable implied volatility.'
                : 'No option-chain data available yet.'}
            </div>
          ) : (
            <GexChart
              rows={chartRows}
              mode={mode}
              spot={point?.spot}
              atmStrike={data?.atm_strike}
              callWall={walls.callWall}
              putWall={walls.putWall}
              gammaFlip={gammaFlip}
              netGexCross={netGexCross}
              showWalls={showWalls}
              showFlip={showFlip}
              snapshotLabel={snapLabel}
            />
          )}

          {/* Time slider — scrub the session's snapshots */}
          <div className="mt-5">
            <div className="flex items-center gap-3">
              {hasSeries && snapIdx !== null && (
                <button
                  onClick={() => setSnapIdx(null)}
                  className="press rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                >
                  Live
                </button>
              )}
              <span className="text-xs font-medium text-slate-500">
                {hasSeries ? fmtClock(series[0].t) : fmtClock(data?.open_ts)}
              </span>
              <div className="relative flex-1">
                {hasSeries ? (
                  <>
                    <span
                      className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow"
                      // Fixed dark hex (not the slate scale, which inverts in dark
                      // themes → invisible white-on-white pill). Matches the Spot pill.
                      style={{ left: `${lastIdx === 0 ? 0 : (effIdx / lastIdx) * 100}%`, background: '#1e293b' }}
                    >
                      {snapLabel}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={lastIdx}
                      step={1}
                      value={effIdx}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        // Snap to the end → resume following live.
                        setSnapIdx(v >= lastIdx ? null : v)
                      }}
                      aria-label="Select snapshot time"
                      className="oi-range h-1.5 w-full cursor-pointer appearance-none rounded-full bg-primary-500/30 accent-primary-600"
                    />
                  </>
                ) : (
                  <div className="relative h-1.5 rounded-full bg-primary-500/30">
                    <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-primary-500/60" />
                    <span className="absolute -top-1 left-0 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-primary-600 bg-white" />
                    <span className="absolute -top-1 right-0 h-3.5 w-3.5 translate-x-1/2 rounded-full border-2 border-primary-600 bg-white" />
                  </div>
                )}
              </div>
              <span className="text-xs font-medium text-slate-500">
                {hasSeries ? fmtClock(series[lastIdx].t) : fmtClock(data?.now_ts)}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Dealer gamma exposure at {snapLabel}
              {data?.data_quality === 'live_proxy' && ' (single live snapshot — intraday scrubbing unlocks as snapshots accrue)'}
              {hasSeries
                ? '. Drag the slider to scrub the session snapshot-by-snapshot.'
                : '.'}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      {/* Hidden checkbox — the <label> activates it on click (one event, no double-fire).
          A <button> inside <label> made the label re-click the button, toggling state
          twice and leaving the switch stuck / misplaced. */}
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={() => onChange(!checked)}
        aria-label={label}
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-block h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </label>
  )
}

function LevelRow({
  label,
  color,
  value,
  hint,
}: {
  label: string
  color: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
          {label}
        </span>
        <span className="text-sm font-bold text-slate-900">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{hint}</p>
    </div>
  )
}
