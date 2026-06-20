import type { ReactNode } from 'react'
import { cn } from '../lib/format'
import { Skeleton } from './ui/Skeleton'

export type BadgeColor = 'green' | 'red' | 'amber' | 'blue' | 'slate'

const BADGE_COLORS: Record<BadgeColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue: 'bg-primary-100 text-primary-700 ring-primary-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

interface MetricCardProps {
  label: string
  value: ReactNode
  badge?: ReactNode
  badgeColor?: BadgeColor
  icon?: ReactNode
  sub?: ReactNode
  loading?: boolean
  className?: string
}

/** White stat card: small label, large value, optional coloured badge. */
export function MetricCard({
  label,
  value,
  badge,
  badgeColor = 'slate',
  icon,
  sub,
  loading = false,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/[0.02]',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {icon && <span className="text-slate-300">{icon}</span>}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-8 w-28" />
      ) : (
        <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      )}

      {!loading && (badge || sub) && (
        <div className="mt-2 flex items-center gap-2">
          {badge && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                BADGE_COLORS[badgeColor],
              )}
            >
              {badge}
            </span>
          )}
          {sub && <span className="text-xs text-slate-500">{sub}</span>}
        </div>
      )}
    </div>
  )
}
