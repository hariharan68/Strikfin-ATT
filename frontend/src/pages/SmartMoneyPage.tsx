import { useMemo } from 'react'
import { getSmartMoney } from '../api/endpoints'
import type { SmartMoneyData, SmartMoneySignal } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import {
  biasLabel,
  biasToTone,
  cn,
  formatInt,
  formatSigned,
  normalizeBias,
  toPercent,
  toneClasses,
} from '../lib/format'
import { BiasPill } from '../components/BiasPill'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, ErrorBanner, EmptyState } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'

type Tone = 'bull' | 'bear' | 'neutral'

/** Map a signal's build-up type to a directional tone. */
function signalTone(s: SmartMoneySignal): Tone {
  // 1 Long Build-up, 4 Short Covering → bullish; 2 Short Build-up, 3 Long Unwinding → bearish
  if (s.signal_type === 1 || s.signal_type === 4) return 'bull'
  if (s.signal_type === 2 || s.signal_type === 3) return 'bear'
  const label = (s.label ?? '').toLowerCase()
  if (label.includes('long build') || label.includes('short cover')) return 'bull'
  if (label.includes('short build') || label.includes('long unwind')) return 'bear'
  return 'neutral'
}

const TONE_BADGE: Record<Tone, string> = {
  bull: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  bear: 'bg-rose-50 text-rose-700 ring-rose-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function SmartMoneyPage() {
  const [instrument, setInstrument] = useInstrument()
  const { data, error, loading, refetch } = useFetch<SmartMoneyData>(
    () => getSmartMoney(instrument),
    [instrument],
    { intervalMs: 15_000 },
  )

  const bias = normalizeBias(data?.aggregate_bias ?? data?.aggregate_label)
  const signals = data?.signals ?? []

  // Derive bull/bear pressure from signal strength and counts.
  const breakdown = useMemo(() => {
    let bull = 0
    let bear = 0
    let neutral = 0
    let bullStrength = 0
    let bearStrength = 0
    for (const s of signals) {
      const tone = signalTone(s)
      const w = s.strength ?? 0
      if (tone === 'bull') {
        bull++
        bullStrength += w
      } else if (tone === 'bear') {
        bear++
        bearStrength += w
      } else {
        neutral++
      }
    }
    const totalStrength = bullStrength + bearStrength
    const bullPct = totalStrength > 0 ? Math.round((bullStrength / totalStrength) * 100) : 50
    return { bull, bear, neutral, bullPct, bearPct: 100 - bullPct }
  }, [signals])

  return (
    <div>
      <PageHeader
        title="Smart Money"
        subtitle="Where institutional positioning is concentrating"
        right={<InstrumentTabs value={instrument} onChange={setInstrument} />}
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      {/* Aggregate */}
      <Panel className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Aggregate Bias
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <h2 className={`mt-1 text-2xl font-bold ${toneClasses[biasToTone(bias)].text}`}>
                {data?.aggregate_label ?? biasLabel(bias)}
              </h2>
            )}
          </div>
          {!loading && (
            <div className="flex items-center gap-2">
              <BiasPill bias={bias} />
              {data?.confidence !== undefined && (
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700">
                  {toPercent(data.confidence)}% confidence
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bull vs bear pressure */}
        {!loading && signals.length > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
              <span className="text-emerald-600">Bullish {breakdown.bullPct}%</span>
              <span className="text-rose-600">{breakdown.bearPct}% Bearish</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${breakdown.bullPct}%` }} />
              <div className="bg-rose-500" style={{ width: `${breakdown.bearPct}%` }} />
            </div>
            {data?.summary && (
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{data.summary}</p>
            )}
          </div>
        )}
      </Panel>

      {/* Signal-count chips */}
      {!loading && signals.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <CountChip label="Signals Found" value={data?.total_signals_found ?? signals.length} tone="neutral" />
          <CountChip label="Bullish" value={breakdown.bull} tone="bull" />
          <CountChip label="Bearish" value={breakdown.bear} tone="bear" />
          <CountChip label="Neutral / Unusual" value={breakdown.neutral} tone="neutral" />
        </div>
      )}

      {/* Signals table */}
      <Panel className="mt-6">
        <PanelHeader title="Top Signals" subtitle="Ranked by strength" />
        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="p-5">
            <EmptyState message="No smart-money signals available." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5">Strike</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Signal</th>
                  <th className="px-4 py-2.5 text-right">OI</th>
                  <th className="px-4 py-2.5 text-right">OI Chg</th>
                  <th className="px-4 py-2.5">Strength</th>
                  <th className="px-4 py-2.5 text-right">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => {
                  const type = s.option_type ?? s.type
                  const tone = signalTone(s)
                  return (
                    <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{formatInt(s.strike)}</td>
                      <td className="px-4 py-2.5">
                        {type && (
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[11px] font-bold',
                              type === 'CE'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700',
                            )}
                          >
                            {type}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {s.label ? (
                          <span
                            className={cn(
                              'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                              TONE_BADGE[tone],
                            )}
                          >
                            {s.label}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatInt(s.oi)}</td>
                      <td
                        className={cn(
                          'px-4 py-2.5 text-right tabular-nums',
                          (s.oi_change ?? 0) > 0 ? 'text-emerald-600' : (s.oi_change ?? 0) < 0 ? 'text-rose-600' : 'text-slate-500',
                        )}
                      >
                        {formatSigned(s.oi_change, 0)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                tone === 'bull' ? 'bg-emerald-500' : tone === 'bear' ? 'bg-rose-500' : 'bg-slate-400',
                              )}
                              style={{ width: `${toPercent(s.strength)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-slate-400">{toPercent(s.strength)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-primary-700">
                        {s.confidence !== undefined ? `${toPercent(s.confidence)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function CountChip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: Tone
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.02]">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'bull' ? 'text-emerald-600' : tone === 'bear' ? 'text-rose-600' : 'text-slate-800',
        )}
      >
        {value}
      </div>
    </div>
  )
}
