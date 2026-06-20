import type { ReactNode } from 'react'
import { cn } from '../lib/format'

interface DisclosureProps {
  /** `bar` = full-width strip; `block` = padded card. */
  variant?: 'bar' | 'block'
  className?: string
  children?: ReactNode
}

const DEFAULT_TEXT =
  'For educational and informational purposes only. Alphalytic AI is not a SEBI-registered investment adviser. ' +
  'Nothing here is investment advice, a recommendation, or a solicitation to buy or sell any security. ' +
  'Levels and signals are illustrative and derived from automated models that may be delayed or inaccurate. ' +
  'Markets carry risk — consult a registered financial adviser before trading.'

/** Amber SEBI-compliance disclaimer. */
export function Disclosure({ variant = 'bar', className, children }: DisclosureProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 border border-amber-200 bg-amber-50 text-amber-800',
        variant === 'bar' ? 'rounded-lg px-4 py-2.5 text-xs' : 'rounded-xl p-4 text-sm',
        className,
      )}
    >
      <span aria-hidden className="mt-px shrink-0 text-amber-500">
        ⚠
      </span>
      <p className="leading-relaxed">{children ?? DEFAULT_TEXT}</p>
    </div>
  )
}
