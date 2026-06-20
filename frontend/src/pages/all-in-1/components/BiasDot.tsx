import type { BiasValue } from '../../../api/endpoints'
import { biasToTone, toneClasses, cn } from '../../../lib/format'

/** Small status dot coloured by bias — bull green, bear red, neutral amber. */
export function BiasDot({ bias, className }: { bias: BiasValue; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 rounded-full', toneClasses[biasToTone(bias)].dot, className)}
      aria-hidden
    />
  )
}
