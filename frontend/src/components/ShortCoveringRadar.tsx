import type { LucideIcon } from 'lucide-react'
import { Check, X, Eye, AlertTriangle, AlertCircle, CheckCircle2, Rocket } from 'lucide-react'
import type { ShortCoveringData, ShortCoveringFactor } from '../api/endpoints'
import { Skeleton } from './ui/Skeleton'

// ── Status config ─────────────────────────────────────────────
const STATUS_CONFIG: Record<string, {
  bg: string; border: string; text: string; dot: string; Icon: LucideIcon; barColor: string
}> = {
  'Watching':       { bg: 'bg-slate-50',                              border: 'border-slate-200',                          text: 'text-slate-500',                          dot: 'bg-slate-400',   Icon: Eye,  barColor: '#94a3b8' },
  'Early Signs':    { bg: 'bg-amber-50   dark:bg-amber-950/20',       border: 'border-amber-200   dark:border-amber-800/40',  text: 'text-amber-700   dark:text-amber-400',   dot: 'bg-amber-400',   Icon: AlertTriangle,  barColor: '#f59e0b' },
  'Possible Rally': { bg: 'bg-orange-50  dark:bg-orange-950/20',      border: 'border-orange-200  dark:border-orange-800/40', text: 'text-orange-700  dark:text-orange-400',  dot: 'bg-orange-400',  Icon: AlertCircle, barColor: '#f97316' },
  'Confirmed':      { bg: 'bg-emerald-50 dark:bg-emerald-950/20',     border: 'border-emerald-200 dark:border-emerald-800/40',text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', Icon: CheckCircle2, barColor: '#10b981' },
  'Strong Signal':  { bg: 'bg-green-50   dark:bg-green-950/20',       border: 'border-green-200   dark:border-green-800/40',  text: 'text-green-700   dark:text-green-400',   dot: 'bg-green-500',   Icon: Rocket, barColor: '#22c55e' },
}

const DEFAULT_CONFIG = STATUS_CONFIG['Watching']

function getConfig(status: string) {
  return STATUS_CONFIG[status] ?? DEFAULT_CONFIG
}

// ── Arc Score Gauge ───────────────────────────────────────────
function ScoreGauge({ score, barColor }: { score: number; barColor: string }) {
  const R = 42
  const cx = 56
  const cy = 56
  const startAngle = -210   // degrees, from bottom-left
  const endAngle   = 30     // degrees, to bottom-right
  const totalArc   = endAngle - startAngle  // 240°

  function polarToXY(angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180
    return {
      x: cx + R * Math.cos(rad),
      y: cy + R * Math.sin(rad),
    }
  }

  function arcPath(fromDeg: number, toDeg: number) {
    const s = polarToXY(fromDeg)
    const e = polarToXY(toDeg)
    const large = toDeg - fromDeg > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`
  }

  const filledEnd = startAngle + (score / 100) * totalArc

  return (
    <svg viewBox="0 0 112 80" className="w-28 h-20" aria-label={`Score: ${score} out of 100`}>
      {/* Track */}
      <path
        d={arcPath(startAngle, endAngle)}
        fill="none"
        stroke="var(--color-slate-200)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* Filled arc */}
      {score > 0 && (
        <path
          d={arcPath(startAngle, filledEnd)}
          fill="none"
          stroke={barColor}
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
      {/* Score text */}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--color-slate-900)">
        {score}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="8" fill="var(--color-slate-400)" fontWeight="600">
        / 100
      </text>
    </svg>
  )
}

// ── Factor row ────────────────────────────────────────────────
function FactorRow({ factor }: { factor: ShortCoveringFactor }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
      factor.fired ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-slate-50'
    }`}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        factor.fired
          ? 'bg-emerald-500 text-white'
          : 'bg-slate-200 text-slate-400'
      }`}>
        {factor.fired ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">{factor.name}</span>
          <span className={`shrink-0 text-xs font-bold ${
            factor.fired ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
          }`}>
            {factor.value}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{factor.description}</p>
      </div>
    </div>
  )
}

// ── Key metric chip ───────────────────────────────────────────
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-base font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

function formatVolume(v: number): string {
  if (!v) return '—'
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)} Cr`
  if (v >= 100_000)    return `${(v / 100_000).toFixed(1)} L`
  if (v >= 1_000)      return `${(v / 1_000).toFixed(0)} K`
  return v.toString()
}

function fmtOI(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : v > 0 ? '+' : ''
  if (abs >= 100_000) return `${sign}${(abs / 100_000).toFixed(1)} L`
  if (abs >= 1_000)   return `${sign}${(abs / 1_000).toFixed(0)} K`
  return `${sign}${abs}`
}

// ── Main component ────────────────────────────────────────────
interface Props {
  data?: ShortCoveringData | null
  loading: boolean
}

export function ShortCoveringRadar({ data, loading }: Props) {
  const status = data?.status ?? 'Watching'
  const cfg    = getConfig(status)

  return (
    <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} overflow-hidden shadow-sm`}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Short Covering Radar</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Detects post-noon short covering rallies using OI, volume & price action
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <div className={`flex items-center gap-2 rounded-full border ${cfg.border} px-3 py-1.5`}>
            <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
            <span className={`flex items-center gap-1 text-xs font-bold ${cfg.text}`}><cfg.Icon size={13} /> {status}</span>
          </div>
        )}
      </div>

      <div className="p-5">
        {/* Top row: gauge + key metrics */}
        <div className="flex flex-wrap items-center gap-5 lg:flex-nowrap">
          {/* Gauge */}
          <div className="flex flex-col items-center">
            {loading ? (
              <Skeleton className="h-20 w-28" />
            ) : (
              <ScoreGauge score={data?.score ?? 0} barColor={cfg.barColor} />
            )}
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Confidence Score
            </p>
          </div>

          {/* Key numbers */}
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : (
              <>
                <Metric
                  label="Recovery"
                  value={data ? `${data.recovery_pct.toFixed(1)}%` : '—'}
                  sub="of day range"
                />
                <Metric
                  label="Call OI Δ"
                  value={data ? fmtOI(data.call_oi_change) : '—'}
                  sub={data?.call_oi_change && data.call_oi_change < 0 ? 'unwinding ✓' : 'building'}
                />
                <Metric
                  label="PCR"
                  value={data ? data.pcr.toFixed(2) : '—'}
                  sub={data?.pcr && data.pcr > 1 ? 'put-heavy' : 'call-heavy'}
                />
                <Metric
                  label="Fut Volume"
                  value={data ? formatVolume(data.futures_volume) : '—'}
                  sub={data?.support_level ? `Support ${data.support_level.toFixed(0)}` : undefined}
                />
              </>
            )}
          </div>
        </div>

        {/* Signal checklist */}
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Signal Breakdown
          </p>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {(data?.factors ?? []).map((f) => (
                <FactorRow key={f.name} factor={f} />
              ))}
            </div>
          )}
        </div>

        {/* Verdict */}
        {!loading && data?.verdict && (
          <div className={`mt-4 rounded-xl border ${cfg.border} p-4`}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              AI Verdict
            </p>
            <p className="text-sm leading-relaxed text-slate-600">{data.verdict}</p>
          </div>
        )}

        {/* Time note */}
        {!loading && data && (
          <p className="mt-3 text-right text-[10px] text-slate-400">
            {data.is_post_noon
              ? '✓ Post-noon window active'
              : '⏳ Pre-noon — patterns strengthen after 12:00 IST'}
          </p>
        )}
      </div>
    </div>
  )
}
