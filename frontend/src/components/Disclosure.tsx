import type { ReactNode } from 'react'
import { cn } from '../lib/format'

interface DisclosureProps {
  /** `bar` = full-width strip; `block` = padded card. */
  variant?: 'bar' | 'block'
  /** `info` = subtle grey (default); `alert` = amber, reserve for live alerts. */
  tone?: 'info' | 'alert'
  className?: string
  children?: ReactNode
}

const DEFAULT_TEXT =
  'For educational and informational purposes only. Alphalytic AI is not a SEBI-registered investment adviser. ' +
  'Nothing here is investment advice, a recommendation, or a solicitation to buy or sell any security. ' +
  'Levels and signals are illustrative and derived from automated models that may be delayed or inaccurate. ' +
  'Markets carry risk — consult a registered financial adviser before trading.'

/**
 * SEBI-compliance disclaimer. Defaults to a subtle, low-weight grey style so it
 * doesn't compete with content; pass `tone="alert"` only for genuine real-time
 * alerts that warrant amber.
 */
export function Disclosure({ variant = 'bar', tone = 'info', className, children }: DisclosureProps) {
  const alert = tone === 'alert'
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 border-t',
        alert
          ? 'rounded-lg border border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-500',
        variant === 'bar' ? 'rounded-lg px-4 py-2.5 text-xs' : 'rounded-xl p-4 text-sm',
        className,
      )}
    >
      <span aria-hidden className={cn('mt-px shrink-0', alert ? 'text-amber-500' : 'text-slate-400')}>
        {alert ? '⚠' : 'ℹ'}
      </span>
      <p className="leading-relaxed">{children ?? DEFAULT_TEXT}</p>
    </div>
  )
}
