import { useEffect, useMemo, useState } from 'react'
import {
  getFutures,
  getOptionsChain,
  getOptionsMetrics,
  getSnapshot,
  INSTRUMENTS,
} from '../api/endpoints'
import type {
  FuturesSnapshot,
  IndexSnapshot,
  OptionChainRow,
  OptionsMetrics,
} from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { cn, formatTimeIST } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { Skeleton } from '../components/ui/Skeleton'
import { Dropdown } from '../components/ui/Menu'

// ─── Indian volume formatter (L / Cr) ────────────────────────────────────────
function fmtVol(v: number | undefined): string {
  if (v === undefined || v === null) return '—'
  if (v >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(2)} Cr`
  if (v >= 1_00_000) return `${(v / 1_00_000).toFixed(2)} L`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} K`
  return String(v)
}

function fmtPrice(v: number | undefined, d = 2): string {
  if (v === undefined) return '—'
  return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtPct(v: number | undefined, d = 2): string {
  if (v === undefined) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(d)}%`
}

// ─── Buildup config ───────────────────────────────────────────────────────────
const BUILDUP_MAP: Record<string, { arrow: string; short: string; cls: string }> = {
  'Short Covering': { arrow: '↑', short: 'SC',  cls: 'bg-emerald-600 text-white' },
  'Long Build-up':  { arrow: '↗', short: 'L',   cls: 'bg-emerald-800 text-white' },
  'Short Build-up': { arrow: '↘', short: 'S',   cls: 'bg-rose-600 text-white' },
  'Long Unwinding': { arrow: '↓', short: 'LU',  cls: 'bg-rose-900 text-rose-200' },
}

function BuildupBadge({ label }: { label?: string }) {
  if (!label) return <span className="text-slate-400">—</span>
  const cfg = BUILDUP_MAP[label]
  if (!cfg) return <span className="text-xs text-slate-500">{label}</span>
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold',
        cfg.cls,
      )}
    >
      <span className="text-[10px]">{cfg.arrow}</span>
      {cfg.short}
    </span>
  )
}

// ─── Expiry helpers ───────────────────────────────────────────────────────────
function upcomingExpiries(count = 8) {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const out: { label: string; daysLabel: string }[] = []
  const d = new Date(from)
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1) // Thursday
  for (let i = 0; i < count; i++) {
    const days = Math.round((d.getTime() - from.getTime()) / 86_400_000)
    out.push({
      label: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(d),
      daysLabel: days === 0 ? 'Today' : `${days}d`,
    })
    d.setDate(d.getDate() + 7)
  }
  return out
}

// ─── OI bar ──────────────────────────────────────────────────────────────────
function OIBar({ value, max, side }: { value: number; max: number; side: 'call' | 'put' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={cn(
          'absolute top-0 h-full rounded-full',
          side === 'call' ? 'right-0 bg-emerald-500' : 'left-0 bg-rose-500',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Volume cell with rank tooltip ───────────────────────────────────────────
function VolCell({
  value,
  rank,
  firstVol,
  highlight,
  align = 'right',
}: {
  value: number | undefined
  rank: number
  firstVol: number
  highlight: boolean
  align?: 'right' | 'left'
}) {
  const [show, setShow] = useState(false)
  const pctOfFirst =
    firstVol > 0 && value !== undefined ? Math.round((value / firstVol) * 100) : 0
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'

  return (
    <td
      className={cn(
        'relative px-2 py-0',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        className={cn(
          'inline-block rounded px-1.5 py-1.5 text-xs font-medium tabular-nums',
          highlight
            ? 'bg-emerald-100 text-emerald-800'
            : 'text-slate-700',
        )}
      >
        {fmtVol(value)}
      </span>

      {show && value !== undefined && (
        <div
          className={cn(
            'pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl shadow-slate-900/10',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="font-semibold text-slate-800">
            Volume Rank: {rank}
            <sup>{suffix}</sup>
          </div>
          <div className="mt-0.5 text-slate-500">
            {pctOfFirst}% of 1<sup>st</sup> highest
          </div>
        </div>
      )}
    </td>
  )
}

// ─── Live clock ───────────────────────────────────────────────────────────────
function LiveClockBadge({ refreshing }: { refreshing?: boolean }) {
  const [now, setNow] = useState(formatTimeIST)
  useEffect(() => {
    const id = setInterval(() => setNow(formatTimeIST()), 1_000)
    return () => clearInterval(id)
  }, [])
  const dateStr = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date())
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {dateStr}, {now}
      <span
        className={cn(
          'h-2 w-2 rounded-full bg-emerald-500',
          refreshing && 'animate-pulse',
        )}
      />
    </span>
  )
}

// ─── Chevron ─────────────────────────────────────────────────────────────────
function ChevronIcon({ open }: { open?: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={cn('transition-transform', open && 'rotate-180')}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const STRIKE_PRESETS = [5, 10, 15, 20] as const

export function OptionChainPage() {
  const [instrument, setInstrument] = useInstrument()
  const [strikeCount, setStrikeCount] = useState<number | 'all'>(15)
  const [expIdx, setExpIdx] = useState(0)
  const expiries = useMemo(() => upcomingExpiries(), [])

  const snapshot = useFetch<IndexSnapshot>(
    () => getSnapshot(instrument), [instrument], { intervalMs: 15_000 },
  )
  const metrics = useFetch<OptionsMetrics>(
    () => getOptionsMetrics(instrument), [instrument], { intervalMs: 15_000 },
  )
  const chain = useFetch<OptionChainRow[]>(
    () => getOptionsChain(instrument), [instrument], { intervalMs: 15_000 },
  )
  const futures = useFetch<FuturesSnapshot>(
    () => getFutures(instrument), [instrument], { intervalMs: 15_000 },
  )

  const snap = snapshot.data
  const m    = metrics.data
  const rows = chain.data ?? []
  const fut  = futures.data

  const loading  = snapshot.loading || metrics.loading || chain.loading
  const instInfo = INSTRUMENTS.find((x) => x.id === instrument)

  // ── Build strike table ──────────────────────────────────────
  const {
    tableRows, atmStrike,
    maxCallOi, maxPutOi,
    volRankCE, volRankPE,
    maxCEVol,  maxPEVol,
  } = useMemo(() => {
    const byStrike = new Map<number, { ce?: OptionChainRow; pe?: OptionChainRow }>()
    for (const r of rows) {
      const e = byStrike.get(r.strike) ?? {}
      if (r.type === 'CE') e.ce = r
      else e.pe = r
      byStrike.set(r.strike, e)
    }

    const strikes = [...byStrike.keys()].sort((a, b) => a - b)
    const spot = m?.spot ?? snap?.last_price
    const atm =
      spot !== undefined && strikes.length
        ? strikes.reduce(
            (b, s) => (Math.abs(s - spot) < Math.abs(b - spot) ? s : b),
            strikes[0],
          )
        : (m?.atm_strike ?? strikes[Math.floor(strikes.length / 2)] ?? 0)

    const atmIdx = strikes.indexOf(atm)
    const lo = strikeCount === 'all' ? 0 : Math.max(0, atmIdx - strikeCount)
    const hi = strikeCount === 'all' ? strikes.length - 1 : Math.min(strikes.length - 1, atmIdx + strikeCount)
    const visible = strikes.slice(lo, hi + 1)

    let maxCE = 1, maxPE = 1
    for (const s of visible) {
      const e = byStrike.get(s)
      if ((e?.ce?.oi ?? 0) > maxCE) maxCE = e!.ce!.oi!
      if ((e?.pe?.oi ?? 0) > maxPE) maxPE = e!.pe!.oi!
    }

    const ceVols = visible
      .map((s) => ({ s, v: byStrike.get(s)?.ce?.volume ?? 0 }))
      .sort((a, b) => b.v - a.v)
    const peVols = visible
      .map((s) => ({ s, v: byStrike.get(s)?.pe?.volume ?? 0 }))
      .sort((a, b) => b.v - a.v)

    return {
      tableRows:  visible.map((s) => ({ strike: s, ...(byStrike.get(s) ?? {}) })),
      atmStrike:  atm,
      maxCallOi:  maxCE,
      maxPutOi:   maxPE,
      volRankCE:  new Map(ceVols.map(({ s }, i) => [s, i + 1])),
      volRankPE:  new Map(peVols.map(({ s }, i) => [s, i + 1])),
      maxCEVol:   ceVols[0]?.v ?? 1,
      maxPEVol:   peVols[0]?.v ?? 1,
    }
  }, [rows, m, snap, strikeCount])

  const spot      = m?.spot ?? snap?.last_price
  const changePct = snap?.change_pct ?? 0
  const futPct    = fut?.change_pct ?? 0
  const vix       = snap?.india_vix
  const maxPain   = m?.max_pain

  const spotColor = changePct > 0 ? 'text-emerald-600' : changePct < 0 ? 'text-rose-600' : 'text-slate-500'
  const futColor  = futPct    > 0 ? 'text-emerald-600' : futPct    < 0 ? 'text-rose-600' : 'text-slate-500'

  function oiChgPct(oi?: number, oiChange?: number): string {
    if (oi === undefined || oiChange === undefined || oiChange === 0) return '—'
    const prev = oi - oiChange
    if (prev === 0) return '—'
    return fmtPct((oiChange / Math.abs(prev)) * 100, 0)
  }

  function oiChgColor(oi?: number, oiChange?: number): string {
    if (oiChange === undefined || oi === undefined || oiChange === 0) return 'text-slate-400'
    const prev = oi - oiChange
    if (prev === 0) return 'text-slate-400'
    const pct = (oiChange / Math.abs(prev)) * 100
    return pct > 0 ? 'text-emerald-600' : 'text-rose-600'
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Control bar ──────────────────────────────────────────── */}
      <Panel className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Instrument pill */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
            <button
              onClick={() => setInstrument(instrument === 1 ? 2 : 1)}
              className="text-slate-400 hover:text-slate-700"
            >
              ‹
            </button>
            <span className="mx-1 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">
                {instInfo?.id === 1 ? '50' : 'SX'}
              </span>
              <span className="text-sm font-semibold text-slate-800">{instInfo?.short}</span>
            </span>
            <button
              onClick={() => setInstrument(instrument === 1 ? 2 : 1)}
              className="text-slate-400 hover:text-slate-700"
            >
              ›
            </button>
          </div>

          {/* Expiry dropdown */}
          <Dropdown
            align="left"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300"
              >
                {expiries[expIdx]?.label}
                <span className="text-xs text-slate-400">({expiries[expIdx]?.daysLabel})</span>
                <ChevronIcon open={open} />
              </button>
            )}
          >
            {(close) => (
              <div className="py-1">
                {expiries.map((e, i) => (
                  <button
                    key={e.label}
                    onClick={() => { setExpIdx(i); close() }}
                    className={cn(
                      'flex w-full items-center justify-between gap-6 px-4 py-2 text-sm transition-colors',
                      i === expIdx
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span>{e.label}</span>
                    <span className="text-xs text-slate-400">{e.daysLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>

          {/* Spot / Future / VIX */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Spot</span>
              <span className="font-bold text-slate-900">{fmtPrice(spot)}</span>
              <span className={cn('font-semibold', spotColor)}>{fmtPct(changePct)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Future</span>
              <span className="font-bold text-slate-900">{fmtPrice(fut?.last_price)}</span>
              <span className={cn('font-semibold', futColor)}>{fmtPct(futPct)}</span>
            </span>
            {vix !== undefined && (
              <span className="flex items-center gap-1.5">
                <span className="text-slate-500">VIX</span>
                <span className="font-bold text-slate-900">{vix.toFixed(2)}</span>
              </span>
            )}
          </div>

          <div className="ml-auto">
            <LiveClockBadge refreshing={loading} />
          </div>
        </div>

        {/* Second row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          <span className="text-xs font-medium text-slate-500">Strikes ±ATM:</span>
          {STRIKE_PRESETS.map((n) => (
            <button
              key={n}
              onClick={() => setStrikeCount(n)}
              className={cn(
                'rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                strikeCount === n
                  ? 'border-primary-300 bg-primary-50 text-primary-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )}
            >
              ±{n}
            </button>
          ))}
          <button
            onClick={() => setStrikeCount('all')}
            className={cn(
              'rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
              strikeCount === 'all'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            All
          </button>

          {/* Summary chips */}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
            {m?.pcr_oi !== undefined && (
              <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1">
                <span className="font-medium uppercase tracking-wide text-slate-400">PCR</span>
                <span className={cn('font-bold tabular-nums', m.pcr_oi >= 1 ? 'text-emerald-600' : 'text-rose-600')}>
                  {m.pcr_oi.toFixed(2)}
                </span>
              </span>
            )}
            {maxPain !== undefined && (
              <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1">
                <span className="font-medium uppercase tracking-wide text-slate-400">Max Pain</span>
                <span className="font-bold tabular-nums text-amber-600">
                  {maxPain.toLocaleString('en-IN')}
                </span>
              </span>
            )}
            {m?.atm_iv !== undefined && (
              <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1">
                <span className="font-medium uppercase tracking-wide text-slate-400">ATM IV</span>
                <span className="font-bold tabular-nums text-slate-800">{m.atm_iv.toFixed(1)}%</span>
              </span>
            )}
          </div>
        </div>
      </Panel>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Panel className="overflow-x-auto p-0">
        {loading ? (
          <div className="space-y-px p-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : tableRows.length === 0 ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <span className="text-4xl opacity-40">📋</span>
            <p className="text-sm font-medium text-slate-600">No option chain data</p>
            <p className="max-w-xs text-xs text-slate-400">
              Connect a live data provider or wait for market hours.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              {/* Section labels */}
              <tr>
                <th
                  colSpan={5}
                  className="border-b border-slate-200 bg-emerald-50 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-emerald-700"
                >
                  Call
                </th>
                <th
                  colSpan={2}
                  className="border-b border-l border-r border-slate-200 bg-slate-50 py-2"
                />
                <th
                  colSpan={5}
                  className="border-b border-slate-200 bg-rose-50 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-rose-700"
                >
                  Put
                </th>
              </tr>
              {/* Column names */}
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide">
                <th className="bg-emerald-50 py-2.5 pl-4 pr-2 text-left text-emerald-600">Buildup</th>
                <th className="bg-emerald-50 px-2 py-2.5 text-right text-emerald-600">Volume</th>
                <th className="bg-emerald-50 px-2 py-2.5 text-right text-emerald-600">OI Chg%</th>
                <th className="bg-emerald-50 px-2 py-2.5 text-right text-emerald-600">OI</th>
                <th className="bg-emerald-50 px-2 py-2.5 text-right text-emerald-600">LTP</th>
                <th className="border-l border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-slate-600">
                  Strike ↑
                </th>
                <th className="border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-slate-600">
                  IV
                </th>
                <th className="bg-rose-50 px-2 py-2.5 text-left text-rose-600">LTP</th>
                <th className="bg-rose-50 px-2 py-2.5 text-left text-rose-600">OI</th>
                <th className="bg-rose-50 px-2 py-2.5 text-left text-rose-600">OI Chg%</th>
                <th className="bg-rose-50 px-2 py-2.5 text-left text-rose-600">Volume</th>
                <th className="bg-rose-50 py-2.5 pl-2 pr-4 text-left text-rose-600">Buildup</th>
              </tr>
            </thead>

            <tbody>
              {tableRows.map(({ strike, ce, pe }) => {
                const isAtm     = strike === atmStrike
                const isMaxPain = maxPain !== undefined && Math.abs(strike - maxPain) < 1
                const ceRank    = volRankCE.get(strike) ?? 99
                const peRank    = volRankPE.get(strike) ?? 99

                return (
                  <tr
                    key={strike}
                    className={cn(
                      'border-b border-slate-100 transition-colors last:border-0',
                      isAtm
                        ? 'bg-amber-50/60 hover:bg-amber-50'
                        : 'hover:bg-slate-50/60',
                    )}
                  >
                    {/* CE — Buildup */}
                    <td className="py-2 pl-4 pr-2">
                      <BuildupBadge label={ce?.buildup} />
                    </td>

                    {/* CE — Volume (rank tooltip) */}
                    <VolCell
                      value={ce?.volume}
                      rank={ceRank}
                      firstVol={maxCEVol}
                      highlight={ceRank <= 3}
                      align="right"
                    />

                    {/* CE — OI Chg% */}
                    <td className="px-2 py-2 text-right text-xs tabular-nums">
                      <span className={oiChgColor(ce?.oi, ce?.oi_change)}>
                        {oiChgPct(ce?.oi, ce?.oi_change)}
                      </span>
                    </td>

                    {/* CE — OI + bar */}
                    <td className="px-2 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs tabular-nums text-slate-700">
                          {fmtVol(ce?.oi)}
                        </span>
                        {ce?.oi !== undefined && (
                          <div className="w-20">
                            <OIBar value={ce.oi} max={maxCallOi} side="call" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* CE — LTP */}
                    <td className="border-r border-slate-100 px-2 py-2 text-right text-sm font-semibold tabular-nums text-emerald-700">
                      {fmtPrice(ce?.ltp)}
                    </td>

                    {/* Strike */}
                    <td className="border-l border-slate-200 bg-slate-50/60 px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span
                          className={cn(
                            'text-sm font-bold tabular-nums',
                            isAtm ? 'text-slate-900' : 'text-slate-700',
                          )}
                        >
                          {strike.toLocaleString('en-IN')}
                        </span>
                        {isMaxPain && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                            Max Pain
                          </span>
                        )}
                        {isAtm && !isMaxPain && (
                          <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                            ATM
                          </span>
                        )}
                      </div>
                    </td>

                    {/* IV — shared */}
                    <td className="border-r border-slate-200 bg-slate-50/60 px-3 py-2 text-center text-xs tabular-nums text-slate-600">
                      {ce?.iv !== undefined
                        ? ce.iv.toFixed(1)
                        : pe?.iv !== undefined
                        ? pe.iv.toFixed(1)
                        : '—'}
                    </td>

                    {/* PE — LTP */}
                    <td className="px-2 py-2 text-left text-sm font-semibold tabular-nums text-rose-700">
                      {fmtPrice(pe?.ltp)}
                    </td>

                    {/* PE — OI + bar */}
                    <td className="px-2 py-2 text-left">
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-xs tabular-nums text-slate-700">
                          {fmtVol(pe?.oi)}
                        </span>
                        {pe?.oi !== undefined && (
                          <div className="w-20">
                            <OIBar value={pe.oi} max={maxPutOi} side="put" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* PE — OI Chg% */}
                    <td className="px-2 py-2 text-left text-xs tabular-nums">
                      <span className={oiChgColor(pe?.oi, pe?.oi_change)}>
                        {oiChgPct(pe?.oi, pe?.oi_change)}
                      </span>
                    </td>

                    {/* PE — Volume (rank tooltip) */}
                    <VolCell
                      value={pe?.volume}
                      rank={peRank}
                      firstVol={maxPEVol}
                      highlight={peRank <= 3}
                      align="left"
                    />

                    {/* PE — Buildup */}
                    <td className="py-2 pl-2 pr-4">
                      <BuildupBadge label={pe?.buildup} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {/* ── Legend ────────────────────────────────────────────────── */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-6 text-xs text-slate-500">
          {[
            { label: 'SC',  desc: 'Short Covering',  cls: 'bg-emerald-600 text-white' },
            { label: 'L',   desc: 'Long Build-up',   cls: 'bg-emerald-800 text-white' },
            { label: 'S',   desc: 'Short Build-up',  cls: 'bg-rose-600 text-white' },
            { label: 'LU',  desc: 'Long Unwinding',  cls: 'bg-rose-900 text-rose-200' },
          ].map((b) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span className={cn('inline-flex h-5 min-w-[28px] items-center justify-center rounded px-1.5 text-[10px] font-bold', b.cls)}>
                {b.label}
              </span>
              {b.desc}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Call OI bar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Put OI bar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-5 items-center rounded bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800">Vol</span>
            Top-3 volume — hover for rank
          </span>
          <span className="ml-auto text-[11px] text-slate-400">
            Refreshes every 15 s · OI lags exchange by 1–3 min
          </span>
        </div>
      </Panel>
    </div>
  )
}
