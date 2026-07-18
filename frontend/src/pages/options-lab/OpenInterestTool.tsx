import { useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { getOILabView, INSTRUMENTS } from '../../api/endpoints'
import type { OILabView } from '../../api/endpoints'
import type { InstrumentId } from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import { useInstrument } from '../../lib/useInstrument'
import { callPutColors, usePreferences } from '../../lib/usePreferences'
import { cn, fmtExpiry, formatNumber } from '../../lib/format'
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

// Quick baseline windows — `minutes` back from the selected "now", or the full
// session ('all'). Drives the open-baseline of the OI build-up.
const QUICK_RANGES: { label: string; minutes: number | 'all' }[] = [
  { label: 'Last 3 min', minutes: 3 },
  { label: 'Last 5 min', minutes: 5 },
  { label: 'Last 10 min', minutes: 10 },
  { label: 'Last 15 min', minutes: 15 },
  { label: 'Last 30 min', minutes: 30 },
  { label: 'Last 1 hr', minutes: 60 },
  { label: 'Last 2 hr', minutes: 120 },
  { label: 'Last 3 hr', minutes: 180 },
  { label: 'All', minutes: 'all' },
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

export function OpenInterestTool() {
  const [instrument, setInstrument] = useInstrument()
  const [mode, setMode] = useState<OIMode>('change_total')
  const [showLot, setShowLot] = useState(false)
  const [strikeFilter, setStrikeFilter] = useState<number | 'all'>(10)
  // Time-range slider: `nowIdx` null = follow the live/last snapshot. `openMode`
  // is the baseline window (minutes back from now, or full session).
  const [nowIdx, setNowIdx] = useState<number | null>(null)
  const [openMode, setOpenMode] = useState<number | 'all'>('all')

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

  // ── time-range slider window ─────────────────────────────────────
  const series = data?.series ?? []
  const hasSeries = series.length >= 2
  const lastIdx = series.length - 1
  // "now" point: the dragged index, or the latest when following live.
  const effNow = hasSeries ? Math.min(nowIdx ?? lastIdx, lastIdx) : 0
  // "open" baseline: full session, or the snapshot ~`openMode` minutes before now.
  const effOpen = useMemo(() => {
    if (!hasSeries || openMode === 'all') return 0
    const target = new Date(series[effNow].t).getTime() - openMode * 60_000
    let idx = 0
    for (let i = 0; i <= effNow; i++) {
      if (new Date(series[i].t).getTime() <= target) idx = i
    }
    return idx
  }, [series, effNow, openMode, hasSeries])

  // ── derive bars (+ strike filter) ────────────────────────────────
  const allBars: OIBar[] = useMemo(() => {
    const strikes = data?.strikes ?? []
    if (hasSeries) {
      const o = series[effOpen]
      const nw = series[effNow]
      return strikes.map((s, i) => {
        const callOpen = o.call[i] ?? 0
        const callNow = nw.call[i] ?? 0
        const putOpen = o.put[i] ?? 0
        const putNow = nw.put[i] ?? 0
        return {
          strike: s.strike,
          callOpen, callNow, callChg: callNow - callOpen,
          callChgPct: callOpen ? Math.round(((callNow - callOpen) / callOpen) * 10000) / 100 : 0,
          putOpen, putNow, putChg: putNow - putOpen,
          putChgPct: putOpen ? Math.round(((putNow - putOpen) / putOpen) * 10000) / 100 : 0,
        }
      })
    }
    return strikes.map((s) => ({
      strike: s.strike,
      callOpen: s.call_oi_open, callNow: s.call_oi_now, callChg: s.call_oi_chg, callChgPct: s.call_oi_chg_pct,
      putOpen: s.put_oi_open, putNow: s.put_oi_now, putChg: s.put_oi_chg, putChgPct: s.put_oi_chg_pct,
    }))
  }, [data, hasSeries, series, effOpen, effNow])

  const bars = useMemo(() => {
    if (strikeFilter === 'all' || !data) return allBars
    const atm = data.atm_strike
    const strikes = allBars.map((b) => b.strike).sort((a, b) => a - b)
    const step = strikes.length > 1 ? strikes[1] - strikes[0] : 50
    const lo = atm - strikeFilter * step
    const hi = atm + strikeFilter * step
    return allBars.filter((b) => b.strike >= lo && b.strike <= hi)
  }, [allBars, strikeFilter, data])

  // Window-aware totals (full chain) for the summary panels + PCR, so they stay
  // consistent with the chart when a sub-window is selected.
  const totals = useMemo(() => {
    let cNow = 0, pNow = 0, cOpen = 0, pOpen = 0
    for (const b of allBars) { cNow += b.callNow; pNow += b.putNow; cOpen += b.callOpen; pOpen += b.putOpen }
    const pcrNow = cNow ? pNow / cNow : 0
    return {
      callOi: cNow, putOi: pNow, callChg: cNow - cOpen, putChg: pNow - pOpen,
      pcr: pcrNow, pcrChange: pcrNow - (cOpen ? pOpen / cOpen : 0),
    }
  }, [allBars])

  const callOi = hasSeries ? totals.callOi : (data?.total_call_oi ?? 0)
  const putOi = hasSeries ? totals.putOi : (data?.total_put_oi ?? 0)
  const callOiChg = hasSeries ? totals.callChg : (data?.total_call_oi_chg ?? 0)
  const putOiChg = hasSeries ? totals.putChg : (data?.total_put_oi_chg ?? 0)
  const pcrNow = hasSeries ? totals.pcr : (data?.pcr_oi ?? 0)
  const pcrChange = hasSeries ? totals.pcrChange : (data?.pcr_change ?? 0)

  const openLabel = hasSeries ? fmtClock(series[effOpen].t) : fmtClock(data?.open_ts)
  const nowLabel = hasSeries ? fmtClock(series[effNow].t) : fmtClock(data?.now_ts)
  const endLabel = hasSeries ? fmtClock(series[lastIdx].t) : nowLabel
  const lotSize = data?.lot_size ?? 75

  const resetRange = () => { setNowIdx(null); setOpenMode('all') }

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

          {/* Expiry */}
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
            <BarChart3 size={16} className="text-slate-400" /> Market Sentiment <span className="text-[11px] font-normal text-slate-400">(based on OI)</span>
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
                  <span className="font-bold text-slate-900">{formatNumber(pcrNow, 2)}</span>
                  <span className={cn('ml-1 font-semibold', pcrChange >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    ({pcrChange >= 0 ? '+' : ''}{formatNumber(pcrChange, 2)})
                  </span>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">ⓘ Market Insight</div>
                {/* Body uses the stable primary scale (not slate, which inverts to
                    light in dark themes → invisible light text on the light primary-50 box). */}
                <p className="mt-1 text-xs leading-snug text-primary-800/90">{data.sentiment.insight}</p>
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
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">Show Lot</span>
                {/* Hidden checkbox — the <label> activates it on click (one event, no double-fire).
                    Using a <button> inside <label> caused the label to re-click the button,
                    toggling state twice and leaving the switch stuck. */}
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showLot}
                  onChange={() => setShowLot((v) => !v)}
                  aria-label="Show lot size units"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative inline-block h-5 w-9 rounded-full transition-colors',
                    showLot ? 'bg-emerald-500' : 'bg-slate-300',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                      showLot ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </span>
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

          {/* Time range (session window) — draggable when intraday history exists */}
          <div className="mt-5">
            <div className="flex items-center gap-3">
              {hasSeries && (
                <button
                  onClick={resetRange}
                  className="press rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                >
                  Reset
                </button>
              )}
              <span className="text-xs font-medium text-slate-500">{hasSeries ? fmtClock(series[0].t) : openLabel}</span>
              <div className="relative flex-1">
                {hasSeries ? (
                  <>
                    {/* Selected "now" bubble, tracking the thumb */}
                    <span
                      className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow"
                      // Fixed dark hex (not the slate scale, which inverts in dark
                      // themes → invisible white-on-white pill). Matches the Spot pill.
                      style={{ left: `${lastIdx === 0 ? 0 : (effNow / lastIdx) * 100}%`, background: '#1e293b' }}
                    >
                      {nowLabel}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={lastIdx}
                      step={1}
                      value={effNow}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        // Snap to the end → resume following live.
                        setNowIdx(v >= lastIdx ? null : v)
                      }}
                      aria-label="Select time point"
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
              <span className="text-xs font-medium text-slate-500">{endLabel}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setOpenMode(r.minutes)}
                  disabled={!hasSeries}
                  className={cn(
                    'press rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                    openMode === r.minutes
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Showing OI build-up from {openLabel} to {nowLabel}
              {data?.data_quality === 'live_proxy' && ' (open estimated from day-over-day OI change until intraday history accrues)'}
              {hasSeries ? '. Drag the slider to scrub through the session.' : '. Custom time-window comparison is coming soon.'}
            </p>
          </div>
        </Panel>

        {/* Bottom panels */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><BarChart3 size={16} className="text-slate-400" /> Open Interest Change</h3>
            {data && <BarPair call={callOiChg} put={putOiChg} showLot={showLot} lot={lotSize} signed />}
          </Panel>
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><BarChart3 size={16} className="text-slate-400" /> Total Open Interest</h3>
            {data && <BarPair call={callOi} put={putOi} showLot={showLot} lot={lotSize} />}
          </Panel>
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><BarChart3 size={16} className="text-slate-400" /> Put/Call Ratio</h3>
            {data && (
              <PcrDonut
                callOi={callOi}
                putOi={putOi}
                pcr={pcrNow}
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
  const { callPutScheme } = usePreferences()
  const cp = callPutColors(callPutScheme)
  const max = Math.max(1, Math.abs(call), Math.abs(put))
  const fmt = (n: number) => (signed && n > 0 ? '+' : '') + fmtOI(n, showLot, lot)
  return (
    <div className="flex h-44 items-end justify-around gap-6 pt-4">
      <Bar label="CALL" value={call} max={max} color={cp.call} text={fmt(call)} />
      <Bar label="PUT" value={put} max={max} color={cp.put} text={fmt(put)} />
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
