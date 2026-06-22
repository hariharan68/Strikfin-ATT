import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/format'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface AnimatedNumberProps {
  value: number | null | undefined
  /** Formats the (interpolated) number for display. */
  format: (n: number) => string
  /** Animation duration in ms. */
  duration?: number
  className?: string
}

/**
 * Counts up/down to `value` with an ease-out curve whenever it changes, so
 * live data visibly "ticks". Falls back to an instant set when the user
 * prefers reduced motion or the value is missing.
 */
export function AnimatedNumber({ value, format, duration = 650, className }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value ?? 0)
  const fromRef = useRef(value ?? 0)
  const rafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(value)) return
    const to = value
    const from = fromRef.current

    if (from === to || prefersReducedMotion()) {
      setDisplay(to)
      fromRef.current = to
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={className}>—</span>
  }
  return <span className={cn('tabular-nums', className)}>{format(display)}</span>
}
