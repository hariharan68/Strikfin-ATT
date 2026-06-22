import { cn } from '../../lib/format'

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/**
 * Subtle placeholder for a data field whose value isn't available yet —
 * replaces a bare "—" with explanatory context. Use for FII/DII and similar
 * fields that only populate post market-open.
 */
export function AwaitingData({
  label = 'Awaiting market data',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-400',
        className,
      )}
    >
      <ClockIcon />
      {label}
    </span>
  )
}
