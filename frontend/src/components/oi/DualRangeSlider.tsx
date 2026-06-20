import { useCallback, useRef } from 'react'

interface DualRangeSliderProps {
  min: number
  max: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  /** Step granularity in the same unit as min/max. */
  step?: number
  /** Render the floating label for an endpoint value. */
  formatLabel?: (v: number) => string
}

/**
 * Two-thumb range slider built on pointer events (no native <input range>),
 * so both handles are reliable across browsers and match the app styling.
 */
export function DualRangeSlider({
  min,
  max,
  value,
  onChange,
  step = 1,
  formatLabel,
}: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [lo, hi] = value
  const span = Math.max(1, max - min)

  const pct = (v: number) => ((v - min) / span) * 100

  const valueFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el) return min
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const raw = min + ratio * span
      return Math.round(raw / step) * step
    },
    [min, span, step],
  )

  const startDrag = useCallback(
    (thumb: 'lo' | 'hi') => (e: React.PointerEvent) => {
      e.preventDefault()
      const move = (ev: PointerEvent) => {
        const v = valueFromClientX(ev.clientX)
        if (thumb === 'lo') {
          onChange([Math.min(v, hi - step), hi])
        } else {
          onChange([lo, Math.max(v, lo + step)])
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [hi, lo, onChange, step, valueFromClientX],
  )

  return (
    <div className="px-1.5 pb-1 pt-5">
      <div ref={trackRef} className="relative h-1.5 rounded-full bg-slate-200">
        {/* Selected segment */}
        <div
          className="absolute top-0 h-1.5 rounded-full bg-primary-500"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        {/* Thumbs */}
        {(['lo', 'hi'] as const).map((thumb) => {
          const v = thumb === 'lo' ? lo : hi
          return (
            <button
              key={thumb}
              type="button"
              onPointerDown={startDrag(thumb)}
              aria-label={thumb === 'lo' ? 'Start time' : 'End time'}
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-primary-500 bg-white shadow-sm active:cursor-grabbing"
              style={{ left: `${pct(v)}%` }}
            >
              {formatLabel && (
                <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-slate-500">
                  {formatLabel(v)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
