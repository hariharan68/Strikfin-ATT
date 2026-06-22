import { useEffect, useState } from 'react'
import { cn, formatTimeIST } from '../../lib/format'

/**
 * Self-ticking "● Live — HH:MM:SS IST" indicator. Unlike LiveBadge it does not
 * need a timestamp prop, so it can sit in every page header consistently.
 */
export function LiveClock({ refreshing, className }: { refreshing?: boolean; className?: string }) {
  const [now, setNow] = useState(() => formatTimeIST())

  useEffect(() => {
    const id = setInterval(() => setNow(formatTimeIST()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600',
        className,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full bg-emerald-500', refreshing && 'animate-pulse-dot')} />
      Live — {now} IST
    </span>
  )
}
