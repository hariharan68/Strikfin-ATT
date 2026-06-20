import { getDashboard, getFutures, getOptionsMetrics, getShortCovering } from '../api/endpoints'
import type {
  DashboardData,
  FuturesSnapshot,
  IndexSnapshot,
  OptionsMetrics,
  ShortCoveringData,
} from '../api/endpoints'
import { ShortCoveringRadar } from '../components/ShortCoveringRadar'
import { useFetch } from '../lib/useFetch'
import {
  formatNumber,
  formatSignedPct,
  formatTimeIST,
} from '../lib/format'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, LiveBadge, ErrorBanner } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { useInstrument } from '../lib/useInstrument'
import { INSTRUMENTS } from '../api/endpoints'

function priceOf(snap?: IndexSnapshot): number | undefined {
  return snap?.ltp ?? snap?.price ?? snap?.last_price
}

function resolveIndex(data: DashboardData | null, id: number, key: 'nifty' | 'sensex') {
  if (!data) return undefined
  return data[key] ?? data.indices?.find((i) => i.instrument_id === id)
}

// ── Sparkline ─────────────────────────────────────────────────
function SparkLine({ color }: { color: string }) {
  const points = [40, 52, 46, 61, 53, 67, 58, 72, 63, 76, 68, 70]
  const max = Math.max(...points)
  const min = Math.min(...points)
  const norm = (v: number) => 100 - ((v - min) / (max - min)) * 70 - 15
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (points.length - 1)) * 200} ${norm(p)}`)
    .join(' ')
  return (
    <svg viewBox="0 0 200 100" className="h-10 w-24 opacity-60" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Volume formatter ───────────────────────────────────────────
function formatVolume(v?: number): string {
  if (v === undefined || v === null) return '—'
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(2)} Cr`
  if (v >= 100_000)    return `${(v / 100_000).toFixed(2)} L`
  if (v >= 1_000)      return `${(v / 1_000).toFixed(1)} K`
  return v.toString()
}

// ── Index price card ──────────────────────────────────────────
interface IndexCardProps {
  label: string
  loading: boolean
  price?: number
  changePct?: number
  vix?: number
  isSelected: boolean
}

function IndexCard({ label, loading, price, changePct, isSelected }: IndexCardProps) {
  const up = (changePct ?? 0) >= 0
  const color = up ? '#10b981' : '#f43f5e'

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${
        isSelected ? 'border-primary-400 ring-2 ring-primary-500 ring-offset-1' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-9 w-36" />
          ) : (
            <p className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-900">
              {formatNumber(price)}
            </p>
          )}
          {loading ? (
            <Skeleton className="mt-2 h-5 w-16" />
          ) : (
            <span
              className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {formatSignedPct(changePct)}
            </span>
          )}
        </div>
        <SparkLine color={color} />
      </div>
      <div className={`absolute bottom-0 left-0 h-1 w-full ${up ? 'bg-emerald-400' : 'bg-rose-400'}`} />
    </div>
  )
}

// ── Futures card ──────────────────────────────────────────────
interface FuturesCardProps {
  label: string
  loading: boolean
  data?: FuturesSnapshot
}

function FuturesCard({ label, loading, data }: FuturesCardProps) {
  const up = (data?.change_pct ?? 0) >= 0
  const color = up ? '#10b981' : '#f43f5e'

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600">
              FUT
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-9 w-36" />
          ) : (
            <p className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-900">
              {formatNumber(data?.last_price)}
            </p>
          )}
          {loading ? (
            <Skeleton className="mt-2 h-5 w-16" />
          ) : (
            <span
              className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {formatSignedPct(data?.change_pct)}
            </span>
          )}
        </div>
        <SparkLine color={color} />
      </div>

      {/* Volume + contract row */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Volume</p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="mt-0.5 text-sm font-bold text-slate-800">{formatVolume(data?.volume)}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Contract</p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-28" />
          ) : (
            <p className="mt-0.5 truncate text-sm font-bold text-slate-800">
              {data?.futures_symbol ?? '—'}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Day High</p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="mt-0.5 text-sm font-semibold text-slate-700">{formatNumber(data?.high_price)}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Day Low</p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="mt-0.5 text-sm font-semibold text-slate-700">{formatNumber(data?.low_price)}</p>
          )}
        </div>
      </div>

      <div className={`absolute bottom-0 left-0 h-1 w-full ${up ? 'bg-emerald-400' : 'bg-rose-400'}`} />
    </div>
  )
}

// ── VIX card ─────────────────────────────────────────────────
function VixCard({ loading, vix }: { loading: boolean; vix?: number }) {
  const elevated = (vix ?? 0) > 16
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">India VIX</p>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-24" />
      ) : (
        <p className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-900">
          {formatNumber(vix)}
        </p>
      )}
      {vix !== undefined && (
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            elevated ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
          }`}
        >
          {elevated ? '⚠ Elevated' : '✓ Calm'}
        </span>
      )}
      <div className={`absolute bottom-0 left-0 h-1 w-full ${elevated ? 'bg-amber-400' : 'bg-blue-400'}`} />
    </div>
  )
}

// ── Options stat tile ─────────────────────────────────────────
interface StatTileProps {
  label: string
  value: React.ReactNode
  sub?: string
  subColor?: string
  loading: boolean
}

function StatTile({ label, value, sub, subColor, loading }: StatTileProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className="mt-1.5 text-2xl font-bold leading-none tracking-tight text-slate-900">{value}</p>
      )}
      {!loading && sub && (
        <span className={`mt-2 inline-block text-xs font-semibold ${subColor ?? 'text-slate-500'}`}>
          {sub}
        </span>
      )}
    </div>
  )
}

function pcrHint(pcr?: number): string | undefined {
  if (pcr === undefined) return undefined
  if (pcr >= 1.2) return 'Put-heavy'
  if (pcr <= 0.8) return 'Call-heavy'
  return 'Balanced'
}

function ivBandColor(label?: string): string {
  switch (label) {
    case 'Very High':
    case 'High':
      return 'text-rose-600'
    case 'Moderate':
      return 'text-amber-600'
    default:
      return 'text-emerald-600'
  }
}

// ── Page ──────────────────────────────────────────────────────
export function AdvancedDashboardPage() {
  const [instrument, setInstrument] = useInstrument()
  const instrumentLabel = INSTRUMENTS.find((i) => i.id === instrument)?.label ?? 'NIFTY 50'
  const isSensex = instrument === 2

  const { data, error, loading, refreshing, refetch } = useFetch<DashboardData>(
    () => getDashboard(),
    [],
    { intervalMs: 30_000 },
  )

  const { data: niftyFut, loading: niftyFutLoading } = useFetch<FuturesSnapshot>(
    () => getFutures(1),
    [],
    { intervalMs: 30_000 },
  )

  const { data: sensexFut, loading: sensexFutLoading } = useFetch<FuturesSnapshot>(
    () => getFutures(2),
    [],
    { intervalMs: 30_000 },
  )

  const { data: shortCovering, loading: scLoading } = useFetch<ShortCoveringData>(
    () => getShortCovering(instrument as 1 | 2),
    [instrument],
    { intervalMs: 30_000 },
  )

  const { data: optMetrics, loading: optLoading } = useFetch<OptionsMetrics>(
    () => getOptionsMetrics(instrument),
    [instrument],
    { intervalMs: 30_000 },
  )

  const nifty  = resolveIndex(data, 1, 'nifty')
  const sensex = resolveIndex(data, 2, 'sensex')
  const vix    = (isSensex ? sensex : nifty)?.india_vix ?? data?.india_vix ?? data?.vix
  const updatedAt = data?.as_of ?? data?.generated_at ?? data?.updated_at

  return (
    <div className="space-y-8">
      <PageHeader
        title="Advanced Dashboard"
        subtitle={`Deep market intelligence — focused on ${instrumentLabel}`}
        right={
          <>
            <InstrumentTabs value={instrument} onChange={setInstrument} />
            <LiveBadge time={formatTimeIST(updatedAt)} refreshing={refreshing} />
          </>
        }
      />

      {error && (
        <ErrorBanner message={error} onRetry={refetch} />
      )}

      {/* Section header */}
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Market Snapshot</h2>
        <div className="flex-1 border-t border-slate-100" />
      </div>

      {/* 3+2 grid: spot | spot | vix on row 1, fut | fut on row 2 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Row 1 */}
        <IndexCard
          label="NIFTY 50"
          loading={loading}
          price={priceOf(nifty)}
          changePct={nifty?.change_pct}
          isSelected={!isSensex}
        />
        <IndexCard
          label="SENSEX"
          loading={loading}
          price={priceOf(sensex)}
          changePct={sensex?.change_pct}
          isSelected={isSensex}
        />
        <VixCard loading={loading} vix={vix} />

        {/* Row 2 */}
        <FuturesCard
          label="NIFTY Futures"
          loading={niftyFutLoading}
          data={niftyFut ?? undefined}
        />
        <FuturesCard
          label="SENSEX Futures"
          loading={sensexFutLoading}
          data={sensexFut ?? undefined}
        />
      </div>

      {/* ── Options Snapshot strip ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="PCR (OI)"
          value={formatNumber(optMetrics?.pcr_oi)}
          sub={pcrHint(optMetrics?.pcr_oi)}
          loading={optLoading}
        />
        <StatTile
          label="Max Pain"
          value={formatNumber(optMetrics?.max_pain, 0)}
          loading={optLoading}
        />
        <StatTile
          label="ATM IV"
          value={optMetrics?.atm_iv !== undefined ? formatNumber(optMetrics.atm_iv) : '—'}
          loading={optLoading}
        />
        <StatTile
          label="IV Percentile"
          value={
            optMetrics?.iv_percentile !== undefined
              ? formatNumber(optMetrics.iv_percentile)
              : '—'
          }
          sub={optMetrics?.iv_percentile_label}
          subColor={ivBandColor(optMetrics?.iv_percentile_label)}
          loading={optLoading}
        />
      </div>

      {/* ── Short Covering Radar ── */}
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Short Covering Radar · {instrumentLabel}
        </h2>
        <div className="flex-1 border-t border-slate-100" />
      </div>

      <ShortCoveringRadar data={shortCovering ?? null} loading={scLoading} />
    </div>
  )
}
