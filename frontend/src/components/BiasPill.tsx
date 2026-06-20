import type { BiasValue } from '../api/endpoints'
import { biasLabel, biasToTone, cn, toneClasses } from '../lib/format'

interface BiasPillProps {
  bias: BiasValue
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES: Record<NonNullable<BiasPillProps['size']>, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-1.5 text-base',
}

/** Coloured bias chip: green (bull), red (bear), amber (neutral). */
export function BiasPill({ bias, label, size = 'md', className }: BiasPillProps) {
  const tone = biasToTone(bias)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset',
        toneClasses[tone].soft,
        SIZES[size],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses[tone].dot)} />
      {label ?? biasLabel(bias)}
    </span>
  )
}
