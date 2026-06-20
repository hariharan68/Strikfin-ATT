import { useMemo, useState } from 'react'
import {
  getOptionsChain,
  getOptionsMetrics,
  getSnapshot,
  INSTRUMENTS,
} from '../api/endpoints'
import type { OptionChainRow, OptionsMetrics, IndexSnapshot } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { cn, formatCompact, formatNumber, formatSignedPct } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { ErrorBanner } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { OIChangeChart } from '../components/oi/OIChangeChart'
import type { StrikeBar } from '../components/oi/OIChangeChart'
import { DualRangeSlider } from '../components/oi/DualRangeSlider'

// ── Session window (IST minutes since midnight) ──────────────────
const SESSION_START = 9 * 60 + 15 // 09:15
const SESSION_CLOSE = 15 * 60 + 30 // 15:30

const TABS = ['OI Change', 'Open Interest', 'Multistrike OI', 'Option OI vs Time', 'Fut OI vs Time'] as const
type Tab = (typeof TABS)[number]

const QUICK_RANGES: { label: string; mins: number | 'all' }[] = [
  { label: 'Last 5 mins', mins: 5 },
  { label: 'Last 10 mins', mins: 10 },
  { label: 'Last 15 mins', mins: 15 },
  { label: 'Last 30 mins', mins: 30 },
  { label: 'Last 1 Hr', mins: 60 },
  { label: 'Last 2 Hrs', mins: 120 },
  { label: 'Last 3 Hrs', mins: 180 },
  { label: 'Full Day', mins: 'all' },
]

const STRIKE_PRESETS = [5, 10, 15, 20, 25]

// ── helpers ──────────────────────────────────────────────────────

/** Current time in IST as minutes since midnight. */
function nowIstMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function minutesToLabel(m: number): string {
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`
}

function signedCompact(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${formatCompact(Math.abs(v))}`
}

/** Upcoming weekly NIFTY/SENSEX expiries (Tuesdays) from a reference date. */
function upcomingExpiries(from: Date, count = 6) {
  const fromMidnight = new Date(from)
  fromMidnight.setHours(0, 0, 0, 0)
  const out: { date: Date; label: string; days: number; monthly: boolean }[] = []
  const d = new Date(fromMidnight)
  // advance to the next Tuesday (day 2)
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1)
  for (let i = 0; i < count; i++) {
    const next = new Date(d)
    next.setDate(next.getDate() + 7)
    const monthly = next.getMonth() !== d.getMonth()
    const days = Math.round((d.getTime() - fromMidnight.getTime()) / 86_400_000)
    out.push({
      date: new Date(d),
      label: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(d),
      days,
      monthly,
    })
    d.setDate(d.getDate() + 7)
  }
  return out
}

export function AdvanceOIPage() {
  const [instrument, setInstrument] = useInstrument()
  const [tab, setTab] = useState<Tab>('OI Change')
  const [showOi, setShowOi] = useState(true)

  const snapshot = useFetch<IndexSnapshot>(() => getSnapshot(instrument), [instrument], {
    intervalMs: 15_000,
  })
  const metrics = useFetch<OptionsMetrics>(() => getOptionsMetrics(instrument), [instrument], {
    intervalMs: 15_000,
  })
  const chain = useFetch<OptionChainRow[]>(() => getOptionsChain(instrument), [instrument], {
    intervalMs: 15_000,
  })

  const snap = snapshot.data
  const m = metrics.data
  const rows = chain.data ?? []

  // ── derive per-strike data ────────────────────────────────────
  const { allBars, atm, step, minStrike, maxStrike, spot } = useMemo(() => {
    const byStrike = new Map<number, { ce?: OptionChainRow; pe?: OptionChainRow }>()
    for (const r of rows) {
      const e = byStrike.get(r.strike) ?? {}
      if (r.type === 'CE') e.ce = r
      else e.pe = r
      byStrike.set(r.strike, e)
    }
    const bars = [...byStrike.entries()]
      .map(([strike, e]) => ({
        strike,
        callChange: e.ce?.oi_change ?? 0,
        putChange: e.pe?.oi_change ?? 0,
        callOi: e.ce?.oi ?? 0,
        putOi: e.pe?.oi ?? 0,
      }))
      .sort((a, b) => a.strike - b.strike)

    const strikes = bars.map((b) => b.strike)
    const spotVal = m?.spot ?? snap?.last_price
    const atmVal =
      spotVal !== undefined && strikes.length
        ? strikes.reduce((best, s) => (Math.abs(s - spotVal) < Math.abs(best - spotVal) ? s : best), strikes[0])
        : (m?.atm_strike ?? strikes[Math.floor(strikes.length / 2)] ?? 0)
    const stepVal = strikes.length > 1 ? strikes[1] - strikes[0] : 50
    return {
      allBars: bars,
      atm: atmVal,
      step: stepVal,
      minStrike: strikes[0] ?? 0,
      maxStrike: strikes[strikes.length - 1] ?? 0,
      spot: spotVal,
    }
  }, [rows, m, snap])

  // ── strike-range controls ─────────────────────────────────────
  const [range, setRange] = useState<{ min: number; max: number } | null>(null)
  const effectiveRange = range ?? { min: minStrike, max: maxStrike }

  const applyPreset = (n: number | 'all') => {
    if (n === 'all') setRange({ min: minStrike, max: maxStrike })
    else setRange({ min: atm - n * step, max: atm + n * step })
  }

  // ── time-window controls ──────────────────────────────────────
  const sessionEnd = useMemo(() => {
    const now = nowIstMinutes()
    if (now < SESSION_START || now > SESSION_CLOSE) return SESSION_CLOSE
    return now
  }, [])
  const [windowRange, setWindowRange] = useState<[number, number] | null>(null)
  const win: [number, number] = windowRange ?? [SESSION_START, sessionEnd]

  const applyQuick = (mins: number | 'all') => {
    if (mins === 'all') setWindowRange([SESSION_START, sessionEnd])
    else setWindowRange([Math.max(SESSION_START, sessionEnd - mins), sessionEnd])
  }
  const activeQuick = (mins: number | 'all'): boolean => {
    if (mins === 'all') return win[0] === SESSION_START && win[1] === sessionEnd
    return win[0] === Math.max(SESSION_START, sessionEnd - mins) && win[1] === sessionEnd
  }

  // window fractions of the session (linear OI build assumption)
  const sessionSpan = Math.max(1, sessionEnd - SESSION_START)
  const f0 = (win[0] - SESSION_START) / sessionSpan
  const f1 = (win[1] - SESSION_START) / sessionSpan

  // ── windowed bars + summary ───────────────────────────────────
  const { bars, callChangeTotal, putChangeTotal } = useMemo(() => {
    const visible = allBars.filter(
      (b) => b.strike >= effectiveRange.min && b.strike <= effectiveRange.max,
    )
    const out: StrikeBar[] = visible.map((b) => ({
      strike: b.strike,
      callChange: b.callChange * (f1 - f0),
      putChange: b.putChange * (f1 - f0),
      callOi: b.callOi - b.callChange + b.callChange * f1,
      putOi: b.putOi - b.putChange + b.putChange * f1,
    }))
    return {
      bars: out,
      callChangeTotal: out.reduce((s, b) => s + b.callChange, 0),
      putChangeTotal: out.reduce((s, b) => s + b.putChange, 0),
    }
  }, [allBars, effectiveRange.min, effectiveRange.max, f0, f1])

  // synthesized NIFTY price path across the session
  const changePct = snap?.change_pct ?? 0
  const open = spot !== undefined ? spot / (1 + changePct / 100) : undefined
  const priceAt = (f: number) =>
    open !== undefined && spot !== undefined ? open + (spot - open) * f : undefined

  const expiries = useMemo(() => upcomingExpiries(new Date()), [])
  const [selectedExpiry, setSelectedExpiry] = useState(0)

  const loading = metrics.loading || chain.loading
  const error = snapshot.error || metrics.error || chain.error
  const instLabel = INSTRUMENTS.find((x) => x.id === instrument)?.label ?? 'NIFTY 50'
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).format(
    new Date(),
  )

  return (
    <div>
      {/* ── Top tab bar ─────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-px sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-400">India VIX</span>
            <span className="font-bold tabular-nums text-slate-800">{formatNumber(snap?.india_vix, 1)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-400">PCR</span>
            <span
              className={cn(
                'font-bold tabular-nums',
                (m?.pcr_oi ?? 1) >= 1 ? 'text-emerald-600' : 'text-rose-600',
              )}
            >
              {formatNumber(m?.pcr_oi, 2)}
            </span>
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-5">
          <ErrorBanner
            message={error}
            onRetry={() => {
              snapshot.refetch()
              metrics.refetch()
              chain.refetch()
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* ── Left controls ─────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Symbol */}
          <Panel className="p-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div>
                <div className="text-sm font-semibold text-slate-800">{instLabel}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold tabular-nums text-slate-900">
                    {formatNumber(snap?.last_price, 2)}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-semibold tabular-nums',
                      changePct >= 0 ? 'text-emerald-600' : 'text-rose-600',
                    )}
                  >
                    {formatSignedPct(changePct)}
                  </span>
                </div>
              </div>
              <InstrumentToggle value={instrument} onChange={setInstrument} />
            </div>

            <div className="mt-3 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5 font-medium text-primary-700">
                <input type="radio" checked readOnly className="accent-primary-600" />
                Intraday
              </label>
              <label className="flex cursor-not-allowed items-center gap-1.5 text-slate-400">
                <input type="radio" disabled className="accent-primary-600" />
                Custom Range
              </label>
            </div>
          </Panel>

          {/* Expiries */}
          <Panel className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Expiries Included
            </div>
            <div className="space-y-1.5">
              {expiries.map((e, i) => (
                <label key={e.label} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="expiry"
                    checked={selectedExpiry === i}
                    onChange={() => setSelectedExpiry(i)}
                    className="accent-primary-600"
                  />
                  <span className="text-slate-700">
                    {e.label}{' '}
                    <span className="text-slate-400">
                      ({e.days === 0 ? 'today' : `${e.days} day${e.days === 1 ? '' : 's'}`})
                    </span>
                  </span>
                  <span
                    className={cn(
                      'ml-auto rounded px-1 text-[10px] font-bold',
                      e.monthly ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700',
                    )}
                  >
                    {e.monthly ? 'M' : 'W'}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Live chain is available for the nearest expiry.
            </p>
          </Panel>

          {/* Strike range */}
          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Strike Range
              </span>
              <button
                onClick={() => setRange(null)}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                ↺ Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StrikeStepper
                label="Min"
                value={effectiveRange.min}
                step={step}
                onChange={(v) => setRange({ min: v, max: effectiveRange.max })}
              />
              <StrikeStepper
                label="Max"
                value={effectiveRange.max}
                step={step}
                onChange={(v) => setRange({ min: effectiveRange.min, max: v })}
              />
            </div>
            <div className="mt-3 text-xs font-medium text-slate-500">Strikes above and below ATM</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <PresetButton label="Show All" active={false} onClick={() => applyPreset('all')} />
              {STRIKE_PRESETS.map((n) => (
                <PresetButton
                  key={n}
                  label={String(n)}
                  active={
                    range?.min === atm - n * step && range?.max === atm + n * step
                  }
                  onClick={() => applyPreset(n)}
                />
              ))}
            </div>
          </Panel>
        </div>

        {/* ── Chart panel ───────────────────────────────────────── */}
        <Panel className="min-w-0 p-5">
          {tab === 'OI Change' || tab === 'Open Interest' ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-800">
                  {tab === 'OI Change' ? `OI Change on ${dateLabel}` : `Open Interest on ${dateLabel}`}
                </h2>
                {tab === 'OI Change' && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <span className="font-medium text-slate-600">Show OI</span>
                    <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                      New
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showOi}
                      onClick={() => setShowOi((v) => !v)}
                      className={cn(
                        'relative h-5 w-9 rounded-full transition-colors',
                        showOi ? 'bg-primary-600' : 'bg-slate-300',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                          showOi ? 'translate-x-4' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </label>
                )}
              </div>

              {loading ? (
                <Skeleton className="h-[360px] w-full" />
              ) : bars.length === 0 ? (
                <div className="flex h-[360px] items-center justify-center text-sm text-slate-400">
                  No option chain data available.
                </div>
              ) : (
                <OIChangeChart
                  bars={bars}
                  mode={tab === 'OI Change' ? 'change' : 'oi'}
                  showOi={showOi}
                  spot={spot}
                  atmStrike={atm}
                />
              )}

              {/* Time window */}
              <div className="mt-5 flex items-center gap-3 text-xs font-medium text-slate-500">
                <span>{minutesToLabel(SESSION_START)}</span>
                <div className="flex-1">
                  <DualRangeSlider
                    min={SESSION_START}
                    max={sessionEnd}
                    value={win}
                    onChange={setWindowRange}
                    formatLabel={minutesToLabel}
                  />
                </div>
                <span>{minutesToLabel(sessionEnd)}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {QUICK_RANGES.map((q) => (
                  <PresetButton
                    key={q.label}
                    label={q.label}
                    active={activeQuick(q.mins)}
                    onClick={() => applyQuick(q.mins)}
                  />
                ))}
              </div>

              {/* Summary */}
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
                <SummaryStat
                  label="Call OI change"
                  value={signedCompact(callChangeTotal)}
                  tone={callChangeTotal >= 0 ? 'up' : 'down'}
                />
                <SummaryStat
                  label="Put OI change"
                  value={signedCompact(putChangeTotal)}
                  tone={putChangeTotal >= 0 ? 'up' : 'down'}
                />
                <SummaryStat
                  label={`${instLabel.split(' ')[0]} at ${minutesToLabel(win[0])}`}
                  value={formatNumber(priceAt(f0), 1)}
                />
                <SummaryStat
                  label={`${instLabel.split(' ')[0]} at ${minutesToLabel(win[1])}`}
                  value={formatNumber(priceAt(f1), 1)}
                />
              </div>
            </>
          ) : (
            <div className="flex h-[400px] flex-col items-center justify-center gap-2 text-center">
              <span className="text-3xl">📊</span>
              <p className="text-sm font-medium text-slate-600">{tab}</p>
              <p className="max-w-sm text-xs text-slate-400">
                This view is coming soon. The OI Change and Open Interest views are fully live.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* Footer note */}
      <Panel className="mt-5 p-5">
        <div className="text-sm font-semibold text-slate-700">
          OI last refreshed — {dateLabel}, {minutesToLabel(sessionEnd)}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Data refreshes periodically. Open Interest is published by the exchange at intervals and is
          not real-time. Intraday OI build-up shown here is interpolated linearly across the session
          from the latest snapshot for illustration.
        </p>
      </Panel>
    </div>
  )
}

// ── small UI pieces ───────────────────────────────────────────────

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-lg font-bold tabular-nums',
          tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-slate-800',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function InstrumentToggle({
  value,
  onChange,
}: {
  value: 1 | 2
  onChange: (v: 1 | 2) => void
}) {
  return (
    <div className="inline-flex rounded-md bg-slate-100 p-0.5">
      {INSTRUMENTS.map((inst) => (
        <button
          key={inst.id}
          onClick={() => onChange(inst.id)}
          className={cn(
            'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
            inst.id === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
          )}
        >
          {inst.short}
        </button>
      ))}
    </div>
  )
}

function StrikeStepper({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="flex items-center rounded-lg border border-slate-200">
        <button
          onClick={() => onChange(value - step)}
          className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
          className="w-full min-w-0 border-x border-slate-200 px-1 py-1.5 text-center text-sm tabular-nums outline-none"
        />
        <button
          onClick={() => onChange(value + step)}
          className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary-300 bg-primary-50 text-primary-700'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  )
}
