import { cn, toPercent } from '../lib/format'

interface ConfidenceBadgeProps {
  /** Accepts 0–1 or 0–100. */
  confidence: number
  showLabel?: boolean
  className?: string
}

/** Blue badge showing a confidence percentage, e.g. "78%". */
export function ConfidenceBadge({ confidence, showLabel = true, className }: ConfidenceBadgeProps) {
  const pct = toPercent(confidence)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700',
        className,
      )}
    >
      {showLabel && <span className="font-medium text-primary-600/80">Confidence</span>}
      {pct}%
    </span>
  )
}
