import { getDashboard, getFutures, getOptionsMetrics } from '../api/endpoints'
import type {
  DashboardData,
  FuturesSnapshot,
  IndexSnapshot,
  OptionsMetrics,
} from '../api/endpoints'
import { useFetch } from '../lib/useFetch'
import {
  formatNumber,
  formatSignedPct,
  formatTimeIST,
} from '../lib/format'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader, LiveBadge, ErrorBanner } from '../components/ui/Page'
import { Skeleton } from '../components/ui/Skeleton'
import { AnimatedNumber } from '../components/ui/AnimatedNumber'
import { useInstrument } from '../lib/useInstrument'
import { INSTRUMENTS } from '../api/endpoints'

function priceOf(snap?: IndexSnapshot): number | undefined {
  return snap?.ltp ?? snap?.price ?? snap?.last_price
}

function resolveIndex(data: DashboardData | null, id: number, key: 'nifty' | 'sensex') {
  if (!data) return undefined
  return data[key] ?? data.indices?.find((i) => i.instrument_id === id)
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
  isSelected: boolean
}

function IndexCard({ label, loading, price, changePct, isSelected }: IndexCardProps) {
  const up = (changePct ?? 0) >= 0

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${
        isSelected ? 'border-primary-400 ring-2 ring-primary-500 ring-offset-1' : 'border-slate-200'
      }`}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-36" />
        ) : (
          <p className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-900">
            <AnimatedNumber value={price} format={(n) => formatNumber(n)} />
          </p>
        )}
        {loading ? (
          <Skeleton className="mt-2 h-5 w-16" />
        ) : (
          <span
            className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              up ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400'
            }`}
          >
            {formatSignedPct(changePct)}
          </span>
        )}
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

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
          <span className="rounded-full bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            FUT
          </span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-36" />
        ) : (
          <p className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-900">
            <AnimatedNumber value={data?.last_price} format={(n) => formatNumber(n)} />
          </p>
        )}
        {loading ? (
          <Skeleton className="mt-2 h-5 w-16" />
        ) : (
          <span
            className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              up ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400'
            }`}
          >
            {formatSignedPct(data?.change_pct)}
          </span>
        )}
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
          <AnimatedNumber value={vix} format={(n) => formatNumber(n)} />
        </p>
      )}
      {vix !== undefined && (
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            elevated ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
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

      {/* ── Gamma Exposure strip ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Net GEX (₹ Cr)"
          value={
            optMetrics?.net_gex !== undefined
              ? formatNumber(optMetrics.net_gex, 0)
              : '—'
          }
          sub={optMetrics?.gex_label}
          subColor={
            (optMetrics?.net_gex ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
          }
          loading={optLoading}
        />
        <StatTile
          label="Zero-Gamma Flip"
          value={
            optMetrics?.gamma_flip !== undefined
              ? formatNumber(optMetrics.gamma_flip, 0)
              : '—'
          }
          sub={
            optMetrics?.gamma_flip && optMetrics?.spot
              ? optMetrics.spot > optMetrics.gamma_flip
                ? 'Spot above — pinning'
                : 'Spot below — trending'
              : undefined
          }
          loading={optLoading}
        />
      </div>
    </div>
  )
}
