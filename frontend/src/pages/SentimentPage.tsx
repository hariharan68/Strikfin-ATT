import { getSentiment } from '../api/endpoints'
import type { SentimentData } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { cn, formatNumber, normalizeBias } from '../lib/format'
import { BiasPill } from '../components/BiasPill'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, ErrorBanner, EmptyState } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'

/** Map a -1..+1 score to a 0..100 position. */
function scoreToPosition(score: number): number {
  return Math.max(0, Math.min(100, ((score + 1) / 2) * 100))
}

function headlineTone(score?: number): string {
  if (score === undefined) return 'text-slate-400'
  return score > 0.1 ? 'text-emerald-600' : score < -0.1 ? 'text-rose-600' : 'text-amber-600'
}

export function SentimentPage() {
  const [instrument, setInstrument] = useInstrument()
  const { data, error, loading, refetch } = useFetch<SentimentData>(
    () => getSentiment(instrument),
    [instrument],
    { intervalMs: 30_000 },
  )

  const score = data?.score ?? 0
  const bias = normalizeBias(data?.label ?? score)
  const drivers = data?.drivers ?? []
  const headlines = data?.headlines ?? []

  return (
    <div>
      <PageHeader
        title="Market Sentiment"
        subtitle="News & narrative sentiment scoring"
        right={<InstrumentTabs value={instrument} onChange={setInstrument} />}
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Gauge */}
        <Panel className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Aggregate Sentiment
            </p>
            {!loading && <BiasPill bias={bias} label={data?.label} />}
          </div>

          {loading ? (
            <Skeleton className="mt-6 h-12 w-full" />
          ) : (
            <>
              <div className="mt-6">
                <div className="relative h-3 w-full rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400">
                  <div
                    className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-slate-800 shadow"
                    style={{ left: `${scoreToPosition(score)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs font-medium text-slate-400">
                  <span>Bearish −1.0</span>
                  <span>Neutral 0</span>
                  <span>+1.0 Bullish</span>
                </div>
              </div>
              <div className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                {formatNumber(score, 2)}
              </div>
            </>
          )}
        </Panel>

        {/* Drivers */}
        <Panel>
          <PanelHeader title="Top Drivers" icon="📰" />
          <div className="p-5">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : drivers.length === 0 ? (
              <EmptyState message="No drivers identified." />
            ) : (
              <ul className="space-y-2 text-sm text-slate-600">
                {drivers.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary-400">•</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      {/* Headlines */}
      <Panel className="mt-6">
        <PanelHeader title="Scored Headlines" />
        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : headlines.length === 0 ? (
          <div className="p-5">
            <EmptyState message="No scored headlines available." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5">Headline</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {headlines.map((h, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 text-slate-700">{h.headline ?? h.title ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{h.source ?? '—'}</td>
                    <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums', headlineTone(h.score))}>
                      {h.score !== undefined ? formatNumber(h.score, 2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
