import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, Brain, Banknote, MessageCircle, Target, Landmark } from 'lucide-react'
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

import { OptionChainTable } from '../components/OptionChainTable'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, LiveBadge, ErrorBanner } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { AwaitingData } from '../components/ui/AwaitingData'
import { AnimatedNumber } from '../components/ui/AnimatedNumber'
import { Markdown } from '../components/Markdown'
import { useInstrument } from '../lib/useInstrument'
import { INSTRUMENTS } from '../api/endpoints'

const QUICK_ACTIONS: { label: string; to: string; Icon: LucideIcon }[] = [
  { label: 'Options Chain', to: '/options', Icon: BarChart3 },
  { label: 'Smart Money', to: '/smart-money', Icon: Banknote },
  { label: 'Ask Copilot', to: '/copilot', Icon: MessageCircle },
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

  // Instrument-aware "focused" slice — drives the bias and options panels.
  const selected = isSensex ? sensex : nifty
  const selectedSignal = isSensex ? data?.sensex_signal : data?.nifty_signal

  const vix = selected?.india_vix ?? data?.india_vix ?? data?.vix
  const bias = normalizeBias(
    selectedSignal?.bias ?? selectedSignal?.bias_label ?? data?.ai_bias?.value ?? data?.ai_bias?.label,
  )
  const biasConfidence = selectedSignal?.confidence ?? data?.ai_bias?.confidence
  const summary = data?.ai_summary ?? data?.summary
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

  // Filter to 5 strikes nearest ATM (2 below, ATM, 2 above) = 10 rows with CE+PE.
  const atmChain = useMemo(() => {
    const atm = selected?.atm_strike ?? data?.nifty?.atm_strike
    if (!atm || chain.length === 0) return chain
    const uniqueStrikes = [...new Set(chain.map((r) => r.strike))].sort(
      (a, b) => Math.abs(a - atm) - Math.abs(b - atm),
    )
    const nearSet = new Set(uniqueStrikes.slice(0, 5))
    return chain
      .filter((r) => nearSet.has(r.strike))
      .sort((a, b) => a.strike - b.strike || (a.type === 'PE' ? -1 : 1))
  }, [chain, selected?.atm_strike, data?.nifty?.atm_strike])

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

      {/* Metric cards — 4 across on desktop, 2×2 ≤768px, single column ≤480px */}
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-4">
        <MetricCard
          label="NIFTY 50"
          loading={loading}
          value={<AnimatedNumber value={priceOf(nifty)} format={(n) => formatNumber(n)} />}
          badge={formatSignedPct(nifty?.change_pct)}
          badgeColor={(nifty?.change_pct ?? 0) >= 0 ? 'green' : 'red'}
          className={!isSensex ? 'ring-2 ring-primary-500 ring-offset-1' : undefined}
        />
        <MetricCard
          label="SENSEX"
          loading={loading}
          value={<AnimatedNumber value={priceOf(sensex)} format={(n) => formatNumber(n)} />}
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
          value={<AnimatedNumber value={vix} format={(n) => formatNumber(n)} />}
          badge={vix !== undefined ? (vix > 16 ? 'Elevated' : 'Calm') : undefined}
          badgeColor={vix !== undefined && vix > 16 ? 'amber' : 'blue'}
        />
      </div>

      {/* Two-column body */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Option Chain" subtitle="Top strikes around spot" icon={<BarChart3 size={16} />} />
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
                rows={atmChain}
                atmStrike={selected?.atm_strike ?? data?.nifty?.atm_strike ?? data?.options?.atm_strike}
              />
            )}
          </Panel>

          {/* AI summary */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-l-4 border-primary-600 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Brain size={16} className="text-primary-600" /> AI Market Summary
              </h3>
              {loading ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <Markdown className="mt-2 text-sm text-slate-600">
                  {summary ?? 'AI summary is not available right now.'}
                </Markdown>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Options metrics */}
          <Panel>
            <PanelHeader title="Options Metrics" icon={<Target size={16} />} />
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

          {/* FII / DII */}
          <Panel>
            <PanelHeader title="FII / DII Flow" icon={<Landmark size={16} />} />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-slate-100">
              <Stat
                label="FII Cash"
                value={inst?.fii_cash_net === undefined ? <AwaitingData /> : formatCrore(inst.fii_cash_net)}
                loading={loading}
                tone={inst?.fii_cash_net}
              />
              <Stat
                label="DII Cash"
                value={inst?.dii_cash_net === undefined ? <AwaitingData /> : formatCrore(inst.dii_cash_net)}
                loading={loading}
                tone={inst?.dii_cash_net}
              />
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
                  <a.Icon size={16} />
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
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
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
