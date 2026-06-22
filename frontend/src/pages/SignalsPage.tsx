import { getLatestSignal } from '../api/endpoints'
import type { SignalData } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { biasLabel, biasToTone, cn, normalizeBias, toneClasses } from '../lib/format'
import { BiasPill } from '../components/BiasPill'
import { ConfidenceBadge } from '../components/ConfidenceBadge'
import { Disclosure } from '../components/Disclosure'
import { Markdown } from '../components/Markdown'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { LiveClock } from '../components/ui/LiveClock'
import { PageHeader, ErrorBanner } from '../components/ui/Page'
import { Skeleton, SkeletonLines } from '../components/ui/Skeleton'

function fmt(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

/** Extract a numeric risk:reward (handles "1:1.8", "1.8", numbers). */
function parseRiskReward(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return value
  const parts = String(value).split(/[:/]/).map((p) => parseFloat(p.trim()))
  if (parts.length === 2 && parts[0] > 0 && !Number.isNaN(parts[1])) return parts[1] / parts[0]
  const single = parseFloat(String(value))
  return Number.isNaN(single) ? undefined : single
}

/** R:R colour: <1 red, 1–2 amber, >2 green. */
function rrColorClass(rr?: number): string {
  if (rr === undefined) return 'text-slate-900'
  if (rr < 1) return 'text-rose-600'
  if (rr <= 2) return 'text-amber-600'
  return 'text-emerald-600'
}

export function SignalsPage() {
  const [instrument, setInstrument] = useInstrument()
  const { data, error, loading, refetch } = useFetch<SignalData>(
    () => getLatestSignal(instrument),
    [instrument],
    { intervalMs: 10_000 },
  )

  const bias = normalizeBias(data?.bias ?? data?.label)
  const tone = biasToTone(bias)

  const rr = parseRiskReward(data?.risk_reward)
  const riskRows: {
    label: string
    value: string
    hint?: string
    valueClass?: string
  }[] = [
    {
      label: 'Entry Ref',
      value: fmt(data?.entry_ref),
      hint: 'Reference Entry Price — Illustrative Only',
    },
    { label: 'Stop Ref', value: fmt(data?.stop_ref) },
    { label: 'Target Ref', value: fmt(data?.target_ref) },
    { label: 'Risk : Reward', value: fmt(data?.risk_reward), valueClass: rrColorClass(rr) },
  ]

  return (
    <div>
      <PageHeader
        title="AI Signals"
        subtitle="Latest model-generated directional bias"
        right={
          <>
            <InstrumentTabs value={instrument} onChange={setInstrument} />
            <LiveClock refreshing={loading} />
          </>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Bias */}
        <Panel className="p-6 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Signal Bias</p>
          {loading ? (
            <Skeleton className="mt-3 h-10 w-40" />
          ) : (
            <>
              <h2 className={`mt-2 text-3xl font-bold tracking-tight ${toneClasses[tone].text}`}>
                {data?.label ?? biasLabel(bias)}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <BiasPill bias={bias} />
                {data?.confidence !== undefined && <ConfidenceBadge confidence={data.confidence} />}
              </div>
            </>
          )}
        </Panel>

        {/* Risk framework */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Risk Framework"
            subtitle="Illustrative — not advice"
            action={
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                Illustrative
              </span>
            }
          />
          {loading ? (
            <div className="p-5">
              <SkeletonLines lines={4} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-slate-100 sm:grid-cols-4">
              {riskRows.map((r) => (
                <div key={r.label} className="bg-white p-4">
                  <div
                    className={cn(
                      'text-xs uppercase tracking-wide text-slate-500',
                      r.hint && 'cursor-help underline decoration-dotted underline-offset-2',
                    )}
                    title={r.hint}
                  >
                    {r.label}
                  </div>
                  <div className={cn('mt-1 text-lg font-bold', r.valueClass ?? 'text-slate-900')}>
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Reasoning */}
      <Panel className="mt-6">
        <PanelHeader title="Reasoning" icon="🧠" />
        <div className="p-5">
          {loading ? (
            <SkeletonLines lines={3} />
          ) : (
            <Markdown className="text-sm text-slate-600">
              {data?.reasoning ?? 'No reasoning provided for the current signal.'}
            </Markdown>
          )}
        </div>
      </Panel>

      <div className="mt-6">
        <Disclosure>
          Entry, stop and target references are <strong>illustrative model outputs</strong>, not
          trade recommendations or investment advice. Alphalytic AI is not a SEBI-registered
          investment adviser. Trading in derivatives carries substantial risk of loss. Consult a
          registered financial adviser before acting.
        </Disclosure>
      </div>
    </div>
  )
}
