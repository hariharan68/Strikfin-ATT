import type { OptionChainRow } from '../api/endpoints'
import { cn, formatInt, formatNumber, formatSigned } from '../lib/format'

const BUILDUP_STYLES: Record<string, string> = {
  'long build-up': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'short build-up': 'bg-rose-50 text-rose-700 ring-rose-200',
  'short covering': 'bg-primary-50 text-primary-700 ring-primary-200',
  'long unwinding': 'bg-orange-50 text-orange-700 ring-orange-200',
}

/** Build-up types in legend order, with their dot colour. */
const BUILDUP_LEGEND: { label: string; dot: string }[] = [
  { label: 'Long Build-up', dot: 'bg-emerald-500' },
  { label: 'Short Build-up', dot: 'bg-rose-500' },
  { label: 'Long Unwinding', dot: 'bg-orange-500' },
  { label: 'Short Covering', dot: 'bg-primary-500' },
]

function buildupStyle(label?: string): string {
  if (!label) return 'bg-slate-100 text-slate-500 ring-slate-200'
  return BUILDUP_STYLES[label.toLowerCase()] ?? 'bg-slate-100 text-slate-600 ring-slate-200'
}

/** Legend row explaining the build-up pill colours. */
export function BuildupLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {BUILDUP_LEGEND.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span className={cn('h-2.5 w-2.5 rounded-full', b.dot)} />
          {b.label}
        </span>
      ))}
    </div>
  )
}

export function BuildupBadge({ label }: { label?: string }) {
  if (!label) return <span className="text-slate-300">—</span>
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        buildupStyle(label),
      )}
    >
      {label}
    </span>
  )
}

function TypeChip({ type }: { type: 'CE' | 'PE' }) {
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold',
        type === 'CE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
      )}
    >
      {type}
    </span>
  )
}

interface OptionChainTableProps {
  rows: OptionChainRow[]
  maxRows?: number
  /** Strike nearest to spot — highlighted as the ATM row. */
  atmStrike?: number
}

export function OptionChainTable({ rows, maxRows, atmStrike }: OptionChainTableProps) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows

  return (
    <div className="overflow-x-auto">
      <table className="table-rows w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2.5">Strike</th>
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5 text-right">OI</th>
            <th className="px-4 py-2.5 text-right">OI Chg</th>
            <th className="px-4 py-2.5 text-right">LTP</th>
            <th className="px-4 py-2.5 text-right">IV</th>
            <th className="px-4 py-2.5">Build-up</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => {
            const isAtm = atmStrike !== undefined && row.strike === atmStrike
            return (
            <tr
              key={`${row.strike}-${row.type}-${i}`}
              className={cn(
                'border-b border-slate-50 last:border-0 hover:bg-slate-50/60',
                isAtm && 'bg-primary-50/60 hover:bg-primary-50 dark:bg-primary-400/10 dark:hover:bg-primary-400/20',
              )}
            >
              <td className="px-4 py-2.5 font-semibold text-slate-800">
                <span className="inline-flex items-center gap-1.5">
                  {formatInt(row.strike)}
                  {isAtm && (
                    <span className="rounded bg-primary-100 px-1 py-0.5 text-[10px] font-bold uppercase text-primary-700">
                      ATM
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <TypeChip type={row.type} />
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {formatInt(row.oi)}
              </td>
              <td
                className={cn(
                  'px-4 py-2.5 text-right tabular-nums',
                  (row.oi_change ?? 0) > 0
                    ? 'text-emerald-600'
                    : (row.oi_change ?? 0) < 0
                      ? 'text-rose-600'
                      : 'text-slate-500',
                )}
              >
                {formatSigned(row.oi_change, 0)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {formatNumber(row.ltp)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {row.iv == null || row.iv <= 0 ? '—' : formatPctSafe(row.iv)}
              </td>
              <td className="px-4 py-2.5">
                <BuildupBadge label={row.buildup} />
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function formatPctSafe(iv: number): string {
  return `${formatNumber(iv, 1)}%`
}
