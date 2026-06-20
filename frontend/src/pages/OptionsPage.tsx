import { useState } from 'react'
import { getOptionsChain, getOptionsMetrics } from '../api/endpoints'
import type { OptionChainRow, OptionsMetrics } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { formatNumber } from '../lib/format'
import { MetricCard } from '../components/MetricCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { OptionChainTable } from '../components/OptionChainTable'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, ErrorBanner, EmptyState } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { cn } from '../lib/format'

type Filter = 'all' | 'CE' | 'PE'

/** Humanise the raw writing-posture enum into a label + badge tone. */
function describePosture(
  posture?: string,
): { label: string; color: 'green' | 'red' | 'slate' } {
  switch (posture) {
    case 'CALL_WRITERS_DOMINANT':
      return { label: 'Call Writers', color: 'red' }
    case 'PUT_WRITERS_DOMINANT':
      return { label: 'Put Writers', color: 'green' }
    case 'BALANCED':
      return { label: 'Balanced', color: 'slate' }
    default:
      return { label: posture ?? '—', color: 'slate' }
  }
}

/** PCR reading → directional hint. */
function pcrHint(pcr?: number): string | undefined {
  if (pcr === undefined) return undefined
  if (pcr >= 1.2) return 'Put-heavy'
  if (pcr <= 0.8) return 'Call-heavy'
  return 'Neutral'
}

export function OptionsPage() {
  const [instrument, setInstrument] = useInstrument()
  const [filter, setFilter] = useState<Filter>('all')

  const metrics = useFetch<OptionsMetrics>(
    () => getOptionsMetrics(instrument),
    [instrument],
    { intervalMs: 10_000 },
  )
  const chain = useFetch<OptionChainRow[]>(
    () => getOptionsChain(instrument),
    [instrument],
    { intervalMs: 10_000 },
  )

  const m = metrics.data
  const allRows = chain.data ?? []
  const rows = allRows.filter((r) => (filter === 'all' ? true : r.type === filter))
  const posture = describePosture(m?.writing_posture)

  // ATM = the chain strike nearest to spot (robust to provider rounding).
  const atmStrike =
    m?.spot !== undefined && allRows.length > 0
      ? allRows.reduce((best, r) =>
          Math.abs(r.strike - m.spot!) < Math.abs(best - m.spot!) ? r.strike : best,
        allRows[0].strike,
        )
      : m?.atm_strike

  return (
    <div>
      <PageHeader
        title="Options Analytics"
        subtitle="Chain, PCR, max pain & OI build-up"
        right={<InstrumentTabs value={instrument} onChange={setInstrument} />}
      />

      {/* Spot / ATM context bar */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm shadow-sm shadow-slate-900/[0.02]">
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Spot</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">
            {formatNumber(m?.spot, 2)}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">ATM</span>
          <span className="font-semibold tabular-nums text-slate-700">
            {formatNumber(m?.atm_strike, 0)}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Call OI
          </span>
          <span className="font-semibold tabular-nums text-slate-700">
            {formatNumber(m?.total_call_oi, 0)}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Put OI
          </span>
          <span className="font-semibold tabular-nums text-slate-700">
            {formatNumber(m?.total_put_oi, 0)}
          </span>
        </span>
      </div>

      {(metrics.error || chain.error) && (
        <div className="mb-5">
          <ErrorBanner
            message={metrics.error ?? chain.error ?? 'Failed to load'}
            onRetry={() => {
              metrics.refetch()
              chain.refetch()
            }}
          />
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="PCR (OI)"
          value={formatNumber(m?.pcr_oi)}
          sub={pcrHint(m?.pcr_oi)}
          loading={metrics.loading}
        />
        <MetricCard
          label="PCR (Vol)"
          value={formatNumber(m?.pcr_volume)}
          sub={pcrHint(m?.pcr_volume)}
          loading={metrics.loading}
        />
        <MetricCard label="Max Pain" value={formatNumber(m?.max_pain, 0)} loading={metrics.loading} />
        <MetricCard label="Support" value={formatNumber(m?.support, 0)} loading={metrics.loading} />
        <MetricCard label="Resistance" value={formatNumber(m?.resistance, 0)} loading={metrics.loading} />
        <MetricCard
          label="Writing"
          value={<span className="text-base">{posture.label}</span>}
          badge={m?.writing_posture?.includes('DOMINANT') ? 'Dominant' : undefined}
          badgeColor={posture.color}
          loading={metrics.loading}
        />
      </div>

      {/* Chain */}
      <Panel className="mt-6">
        <PanelHeader
          title="Option Chain"
          subtitle="Colour-coded by OI build-up"
          action={
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              {(['all', 'CE', 'PE'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                  )}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
            </div>
          }
        />
        {chain.loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState message="No option chain rows to display." />
          </div>
        ) : (
          <OptionChainTable rows={rows} atmStrike={atmStrike} />
        )}
      </Panel>
    </div>
  )
}
