import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getDashboard } from '../api/endpoints'
import type { DashboardData, IndexSnapshot } from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import {
  biasLabel,
  biasToTone,
  formatCrore,
  formatNumber,
  formatSignedPct,
  formatTimeIST,
  normalizeBias,
  toneClasses,
} from '../lib/format'
import { MetricCard } from '../components/MetricCard'
import { BiasPill } from '../components/BiasPill'
import { Disclosure } from '../components/Disclosure'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ProgressBar } from '../components/ui/ProgressBar'
import { OptionChainTable } from '../components/OptionChainTable'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, LiveBadge, ErrorBanner } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { useInstrument } from '../lib/useInstrument'
import { INSTRUMENTS } from '../api/endpoints'

const QUICK_ACTIONS = [
  { label: 'Options Chain', to: '/options', icon: '📊' },
  { label: 'AI Signals', to: '/signals', icon: '🧠' },
  { label: 'Smart Money', to: '/smart-money', icon: '💸' },
  { label: 'Ask Copilot', to: '/copilot', icon: '💬' },
]

function priceOf(snap?: IndexSnapshot): number | undefined {
  return snap?.ltp ?? snap?.price ?? snap?.last_price
}

function resolveIndex(data: DashboardData | null, id: number, key: 'nifty' | 'sensex') {
  if (!data) return undefined
  return data[key] ?? data.indices?.find((i) => i.instrument_id === id)
}

export function DashboardPage() {
  const [instrument, setInstrument] = useInstrument()
  const { data, error, loading, refreshing, refetch } = useFetch<DashboardData>(
    () => getDashboard(),
    [],
    { intervalMs: 30_000 },
  )

  const isSensex = instrument === 2
  const instrumentLabel = INSTRUMENTS.find((i) => i.id === instrument)?.label ?? 'NIFTY 50'

  const nifty = resolveIndex(data, 1, 'nifty')
  const sensex = resolveIndex(data, 2, 'sensex')

  // Instrument-aware "focused" slice — drives the bias, regime and options panels.
  const selected = isSensex ? sensex : nifty
  const selectedRegime = (isSensex ? data?.sensex_regime : data?.nifty_regime) ?? data?.regime
  const selectedSignal = isSensex ? data?.sensex_signal : data?.nifty_signal

  const vix = selected?.india_vix ?? data?.india_vix ?? data?.vix
  const bias = normalizeBias(
    selectedSignal?.bias ?? selectedSignal?.bias_label ?? data?.ai_bias?.value ?? data?.ai_bias?.label,
  )
  const biasConfidence = selectedSignal?.confidence ?? data?.ai_bias?.confidence
  const summary = data?.ai_summary ?? data?.summary
  const regime = selectedRegime
  const regimeEvidence: string[] =
    regime?.evidence && regime.evidence.length > 0
      ? regime.evidence
          .map((e) => e.title ?? e.name ?? e.detail ?? e.description)
          .filter((s): s is string => Boolean(s))
      : Object.entries(regime?.top_features ?? {}).map(([k, v]) => `${k}: ${v}`)
  // Options metrics: prefer a full options block, else derive from the focused index card.
  const options = data?.options ?? {
    pcr_oi: selected?.pcr_oi,
    max_pain: selected?.atm_strike,
    support: selected?.support,
    resistance: selected?.resistance,
  }
  const inst = data?.institutional
  const chain = data?.option_chain ?? []
  const updatedAt = data?.as_of ?? data?.generated_at ?? data?.updated_at

  return (
    <div>
      <PageHeader
        title="Intelligence Dashboard"
        subtitle={`Live market intelligence — focused on ${instrumentLabel}`}
        right={
          <>
            <InstrumentTabs value={instrument} onChange={setInstrument} />
            <LiveBadge time={formatTimeIST(updatedAt)} refreshing={refreshing} />
          </>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={refetch} />
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="NIFTY 50"
          loading={loading}
          value={formatNumber(priceOf(nifty))}
          badge={formatSignedPct(nifty?.change_pct)}
          badgeColor={(nifty?.change_pct ?? 0) >= 0 ? 'green' : 'red'}
          className={!isSensex ? 'ring-2 ring-primary-500 ring-offset-1' : undefined}
        />
        <MetricCard
          label="SENSEX"
          loading={loading}
          value={formatNumber(priceOf(sensex))}
          badge={formatSignedPct(sensex?.change_pct)}
          badgeColor={(sensex?.change_pct ?? 0) >= 0 ? 'green' : 'red'}
          className={isSensex ? 'ring-2 ring-primary-500 ring-offset-1' : undefined}
        />
        <MetricCard
          label={`AI Bias · ${instrumentLabel}`}
          loading={loading}
          value={<span className={toneClasses[biasToTone(bias)].text}>{biasLabel(bias)}</span>}
          sub={
            biasConfidence !== undefined
              ? `${Math.round(biasConfidence <= 1 ? biasConfidence * 100 : biasConfidence)}% confidence`
              : undefined
          }
        />
        <MetricCard
          label="India VIX"
          loading={loading}
          value={formatNumber(vix)}
          badge={vix !== undefined ? (vix > 16 ? 'Elevated' : 'Calm') : undefined}
          badgeColor={vix !== undefined && vix > 16 ? 'amber' : 'blue'}
        />
      </div>

      {/* Two-column body */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Option Chain" subtitle="Top strikes around spot" icon="📊" />
            {loading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : chain.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                No option chain data available.
              </p>
            ) : (
              <OptionChainTable
                rows={chain}
                maxRows={10}
                atmStrike={selected?.atm_strike ?? data?.options?.atm_strike}
              />
            )}
          </Panel>

          {/* AI summary */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-l-4 border-primary-600 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                🧠 AI Market Summary
              </h3>
              {loading ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {summary ?? 'AI summary is not available right now.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Options metrics */}
          <Panel>
            <PanelHeader title="Options Metrics" icon="🎯" />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-slate-100">
              <Stat label="PCR (OI)" value={formatNumber(options?.pcr_oi)} loading={loading} />
              <Stat label="Max Pain" value={formatNumber(options?.max_pain, 0)} loading={loading} />
              <Stat label="Support" value={formatNumber(options?.support, 0)} loading={loading} />
              <Stat label="Resistance" value={formatNumber(options?.resistance, 0)} loading={loading} />
              <Stat
                label="Writing Posture"
                value={options?.writing_posture ?? '—'}
                loading={loading}
                wide
              />
            </dl>
          </Panel>

          {/* Market regime */}
          <Panel>
            <PanelHeader title="Market Regime" icon="📈" />
            <div className="p-5">
              {loading ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-slate-900">
                      {regime?.regime_label ?? regime?.label ?? regime?.state ?? '—'}
                    </span>
                    {regime?.confidence !== undefined && (
                      <span className="text-sm font-semibold text-primary-600">
                        {Math.round(regime.confidence <= 1 ? regime.confidence * 100 : regime.confidence)}%
                      </span>
                    )}
                  </div>
                  {regime?.confidence !== undefined && (
                    <ProgressBar value={regime.confidence} className="mt-3" />
                  )}
                  {regimeEvidence.length > 0 && (
                    <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
                      {regimeEvidence.slice(0, 4).map((e, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary-400">•</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Panel>

          {/* FII / DII */}
          <Panel>
            <PanelHeader title="FII / DII Flow" icon="🏦" />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-slate-100">
              <Stat label="FII Cash" value={formatCrore(inst?.fii_cash_net)} loading={loading} tone={inst?.fii_cash_net} />
              <Stat label="DII Cash" value={formatCrore(inst?.dii_cash_net)} loading={loading} tone={inst?.dii_cash_net} />
            </div>
          </Panel>

          {/* Quick actions */}
          <Panel className="p-4">
            <h3 className="mb-3 px-1 text-sm font-semibold text-slate-800">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                >
                  <span>{a.icon}</span>
                  {a.label}
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6">
        <Disclosure />
      </div>

      {/* AI bias chip for clarity on small screens */}
      <div className="sr-only">
        <BiasPill bias={bias} />
      </div>
    </div>
  )
}

interface StatProps {
  label: string
  value: ReactNode
  loading?: boolean
  wide?: boolean
  tone?: number
}

function Stat({ label, value, loading, wide, tone }: StatProps) {
  const toneClass =
    tone === undefined ? 'text-slate-900' : tone > 0 ? 'text-emerald-600' : tone < 0 ? 'text-rose-600' : 'text-slate-900'
  return (
    <div className={cnWide(wide)}>
      <dt className="text-xs text-slate-500">{label}</dt>
      {loading ? (
        <Skeleton className="mt-1 h-5 w-16" />
      ) : (
        <dd className={`mt-0.5 text-sm font-semibold ${toneClass}`}>{value}</dd>
      )}
    </div>
  )
}

function cnWide(wide?: boolean): string {
  return `bg-white p-4 ${wide ? 'col-span-2' : ''}`
}
