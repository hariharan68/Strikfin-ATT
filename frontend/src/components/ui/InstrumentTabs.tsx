import type { Instrument, InstrumentId } from '../../api/endpoints'
import { cn } from '../../lib/format'
import { useInstruments } from '../../lib/useInstruments'

interface InstrumentTabsProps {
  value: InstrumentId
  onChange: (id: InstrumentId) => void
  className?: string
  /** Cap how many tabs render (rest reachable via search). Default 4. */
  max?: number
}

/**
 * Segmented instrument switcher — now catalog-driven (from the live instrument
 * master) rather than a fixed NIFTY/SENSEX pair. Shows up to `max` instruments
 * (plus the selected one if it falls outside the visible slice); the global
 * search handles the long tail.
 */
export function InstrumentTabs({ value, onChange, className, max = 4 }: InstrumentTabsProps) {
  const { catalog } = useInstruments()

  // Visible slice + ensure the selected instrument is always present.
  const visible: Instrument[] = catalog.slice(0, max)
  if (value && !visible.some((i) => i.id === value)) {
    const sel = catalog.find((i) => i.id === value)
    if (sel) visible.push(sel)
  }

  return (
    <div
      className={cn(
        'inline-flex rounded-lg border border-slate-200 bg-white p-1',
        className,
      )}
    >
      {visible.map((inst) => {
        const active = inst.id === value
        return (
          <button
            key={inst.id}
            onClick={() => onChange(inst.id)}
            className={cn(
              'press rounded-md px-4 py-1.5 text-sm font-medium',
              active
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {inst.label}
          </button>
        )
      })}
    </div>
  )
}
