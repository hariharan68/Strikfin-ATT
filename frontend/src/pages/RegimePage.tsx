import { getRegime } from '../api/endpoints'
import type { RegimeData } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import { useInstrument } from '../lib/useInstrument'
import { cn, toPercent, formatDateTimeIST } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, ErrorBanner, EmptyState } from '../components/ui/Page'
import { Skeleton, SkeletonLines } from '../components/ui/Skeleton'

interface RegimeTheme {
  code: number
  label: string
  short: string
  icon: string
  text: string
  bar: string
  ring: string
  soft: string
  description: string
}

const REGIME_THEMES: Record<number, RegimeTheme> = {
  1: { code: 1, label: 'Trend Up', short: 'Trend Up', icon: '↗', text: 'text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-200', soft: 'bg-emerald-50', description: 'Sustained upward momentum with trend-strength confirmation. Dips tend to get bought.' },
  2: { code: 2, label: 'Trend Down', short: 'Trend Down', icon: '↘', text: 'text-rose-600', bar: 'bg-rose-500', ring: 'ring-rose-200', soft: 'bg-rose-50', description: 'Sustained downward momentum; sellers in control. Rallies tend to get sold.' },
  3: { code: 3, label: 'Sideways', short: 'Sideways', icon: '↔', text: 'text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-200', soft: 'bg-amber-50', description: 'Range-bound with low directional momentum. Favourable for range / theta strategies.' },
  4: { code: 4, label: 'Breakout', short: 'Breakout', icon: '⤴', text: 'text-primary-700', bar: 'bg-primary-600', ring: 'ring-primary-200', soft: 'bg-primary-50', description: 'Price breaking a compressed range with OI confirmation. Momentum expansion underway.' },
  5: { code: 5, label: 'Reversal', short: 'Reversal', icon: '⤺', text: 'text-fuchsia-600', bar: 'bg-fuchsia-500', ring: 'ring-fuchsia-200', soft: 'bg-fuchsia-50', description: 'Momentum turning and positions unwinding. Trade with caution near the inflection.' },
  6: { code: 6, label: 'High Volatility', short: 'High Vol', icon: '⚡', text: 'text-orange-600', bar: 'bg-orange-500', ring: 'ring-orange-200', soft: 'bg-orange-50', description: 'Elevated volatility — VIX spike or range expansion. Size down, widen stops.' },
  7: { code: 7, label: 'Low Volatility', short: 'Low Vol', icon: '🌙', text: 'text-slate-600', bar: 'bg-slate-500', ring: 'ring-slate-200', soft: 'bg-slate-100', description: 'Compressed, calm regime — often a pre-event lull before expansion.' },
}

function themeFor(data?: RegimeData): RegimeTheme | null {
  if (!data) return null
  if (data.regime && REGIME_THEMES[data.regime]) return REGIME_THEMES[data.regime]
  const label = (data.label ?? '').toLowerCase()
  return (
    Object.values(REGIME_THEMES).find((t) => t.label.toLowerCase() === label) ?? null
  )
}

/** Derive a directional tone from an evidence description string. */
function evidenceTone(detail?: string): 'bull' | 'bear' | 'neutral' {
  const s = (detail ?? '').toLowerCase()
  if (s.includes('bullish') || s.includes('trend up') || s.includes('floor') || s.includes('net buy') || s.includes('net long')) return 'bull'
  if (s.includes('bearish') || s.includes('trend down') || s.includes('ceiling') || s.includes('net sell') || s.includes('net short')) return 'bear'
  return 'neutral'
}

const EVIDENCE_TONE: Record<'bull' | 'bear' | 'neutral', string> = {
  bull: 'border-emerald-200 bg-emerald-50/40',
  bear: 'border-rose-200 bg-rose-50/40',
  neutral: 'border-slate-200 bg-white',
}

export function RegimePage() {
  const [instrument, setInstrument] = useInstrument()
  const { data, error, loading, refetch } = useFetch<RegimeData>(
    () => getRegime(instrument),
    [instrument],
    { intervalMs: 30_000 },
  )

  const theme = themeFor(data)
  const label = data?.label ?? theme?.label
  const evidence = data?.evidence ?? []

  return (
    <div>
      <PageHeader
        title="Market Regime"
        subtitle="7-state regime classification"
        right={<InstrumentTabs value={instrument} onChange={setInstrument} />}
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      {/* Hero */}
      <Panel className={cn('overflow-hidden p-6', theme && `ring-1 ring-inset ${theme.ring}`)}>
        {loading ? (
          <Skeleton className="h-10 w-56" />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                {theme && (
                  <span
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-2xl text-2xl',
                      theme.soft,
                      theme.text,
                    )}
                  >
                    {theme.icon}
                  </span>
                )}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Current regime
                  </p>
                  <h2 className={cn('mt-0.5 text-3xl font-bold tracking-tight', theme?.text ?? 'text-slate-900')}>
                    {label ?? '—'}
                  </h2>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {data?.model_version && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    model {data.model_version}
                  </span>
                )}
                {data?.updated_at && (
                  <span className="text-xs text-slate-400">
                    {formatDateTimeIST(data.updated_at)} IST
                  </span>
                )}
              </div>
            </div>

            {theme && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">
                {theme.description}
              </p>
            )}

            {data?.confidence !== undefined && (
              <div className="mt-5">
                <div className="mb-1.5 flex justify-between text-xs font-medium text-slate-500">
                  <span>Confidence</span>
                  <span className={theme?.text ?? 'text-primary-600'}>{toPercent(data.confidence)}%</span>
                </div>
                <ProgressBar value={data.confidence} barClassName={theme?.bar} />
              </div>
            )}
          </>
        )}
      </Panel>

      {/* 7-state strip */}
      {!loading && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Regime states
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.values(REGIME_THEMES).map((t) => {
              const active = theme?.code === t.code
              return (
                <span
                  key={t.code}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? cn(t.soft, t.text, 'border-transparent ring-1 ring-inset', t.ring)
                      : 'border-slate-200 text-slate-400',
                  )}
                >
                  <span>{t.icon}</span>
                  {t.short}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Evidence */}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-800">
        Evidence
        {!loading && evidence.length > 0 && (
          <span className="ml-2 text-xs font-normal text-slate-400">
            {evidence.length} signal{evidence.length === 1 ? '' : 's'} considered
          </span>
        )}
      </h3>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Panel key={i} className="p-4">
              <SkeletonLines lines={2} />
            </Panel>
          ))}
        </div>
      ) : evidence.length === 0 ? (
        <EmptyState message="No regime evidence available." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {evidence.map((e, i) => {
            const tone = evidenceTone(e.detail ?? e.description)
            return (
              <div
                key={i}
                className={cn('rounded-xl border p-4 shadow-sm shadow-slate-900/[0.02]', EVIDENCE_TONE[tone])}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {e.title ?? e.name ?? `Feature ${i + 1}`}
                  </span>
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      tone === 'bull' ? 'bg-emerald-500' : tone === 'bear' ? 'bg-rose-500' : 'bg-slate-300',
                    )}
                  />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {e.detail ?? e.description ?? '—'}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
