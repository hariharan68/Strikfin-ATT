import { cn, toPercent } from '../../lib/format'

interface ProgressBarProps {
  /** 0–1 or 0–100. */
  value: number
  className?: string
  barClassName?: string
}

export function ProgressBar({ value, className, barClassName }: ProgressBarProps) {
  const pct = toPercent(value)
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cn('h-full rounded-full bg-primary-600 transition-all duration-500', barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
