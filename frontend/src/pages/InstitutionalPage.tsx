import { Compass } from 'lucide-react'
import { getInstitutional } from '../api/endpoints'
import type { InstitutionalData } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { formatCrore, formatInt, formatDateTimeIST, formatTimeIST, cn } from '../lib/format'
import { MetricCard } from '../components/MetricCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { PageHeader, ErrorBanner, LiveBadge } from '../components/ui/Page'
import { AwaitingData } from '../components/ui/AwaitingData'
import { SkeletonLines } from '../components/ui/Skeleton'

function flowColor(value?: number): 'green' | 'red' | 'slate' {
  if (value === undefined) return 'slate'
  return value > 0 ? 'green' : value < 0 ? 'red' : 'slate'
}

/** Net long/short tilt of FII index-futures contracts. */
function futuresTilt(long?: number, short?: number) {
  if (long === undefined || short === undefined || long + short === 0) {
    return { label: 'No data', pct: 0, color: 'slate' as const }
  }
  const longPct = Math.round((long / (long + short)) * 100)
  if (long > short * 1.15) return { label: 'Net Long', pct: longPct, color: 'green' as const }
  if (short > long * 1.15) return { label: 'Net Short', pct: longPct, color: 'red' as const }
  return { label: 'Balanced', pct: longPct, color: 'slate' as const }
}

export function InstitutionalPage() {
  const { data, error, loading, refetch, refreshing } = useFetch<InstitutionalData>(
    () => getInstitutional(),
    [],
    { intervalMs: 60_000 },
  )

  const cards = [
    { label: 'FII Cash Net', value: data?.fii_cash_net },
    { label: 'DII Cash Net', value: data?.dii_cash_net },
    { label: 'FII Futures Net', value: data?.fii_futures_net },
    { label: '5D Rolling', value: data?.rolling_5d },
    { label: '20D Rolling', value: data?.rolling_20d },
  ]

  const tilt = futuresTilt(data?.fii_long_contracts, data?.fii_short_contracts)
  const provisional = data?.provisional ?? true

  return (
    <div>
      <PageHeader
        title="Institutional Flow"
        subtitle="FII / DII cash & derivatives positioning"
        right={<LiveBadge time={formatTimeIST(data?.as_of)} refreshing={refreshing} />}
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <MetricCard
            key={c.label}
            label={c.label}
            loading={loading}
            value={c.value === undefined ? <AwaitingData label="Available post-market" /> : formatCrore(c.value)}
            badge={c.value !== undefined ? (c.value >= 0 ? 'Inflow' : 'Outflow') : undefined}
            badgeColor={flowColor(c.value)}
          />
        ))}
      </div>

      {/* FII index-futures positioning */}
      <Panel className="mt-6">
        <PanelHeader title="FII Index Futures Positioning" subtitle="Open contracts long vs short" />
        <div className="p-5">
          {loading ? (
            <SkeletonLines lines={2} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-6 text-sm">
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Long
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-600">
                      {formatInt(data?.fii_long_contracts)}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Short
                    </span>
                    <span className="font-semibold tabular-nums text-rose-600">
                      {formatInt(data?.fii_short_contracts)}
                    </span>
                  </span>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
                    tilt.color === 'green'
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : tilt.color === 'red'
                        ? 'bg-rose-50 text-rose-700 ring-rose-200'
                        : 'bg-slate-100 text-slate-600 ring-slate-200',
                  )}
                >
                  {tilt.label}
                </span>
              </div>
              {/* Long/short split bar */}
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="bg-emerald-500" style={{ width: `${tilt.pct}%` }} />
                <div className="bg-rose-500" style={{ width: `${100 - tilt.pct}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
                <span>{tilt.pct}% long</span>
                <span>{100 - tilt.pct}% short</span>
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Interpretation" icon={<Compass size={16} />} />
        <div className="p-5">
          {loading ? (
            <SkeletonLines lines={3} />
          ) : (
            <p className="text-sm leading-relaxed text-slate-600">
              {data?.interpretation ?? 'No interpretation available for the latest flow data.'}
            </p>
          )}
        </div>
      </Panel>

      <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <span aria-hidden>ℹ</span>
        <p>
          {provisional
            ? 'Provisional data — FII/DII figures are sourced from exchange provisional reports and may be revised. '
            : 'Final data — sourced from NSDL/CDSL. '}
          {data?.as_of ? `As of ${formatDateTimeIST(data.as_of)} IST.` : ''}
        </p>
      </div>
    </div>
  )
}
