import { INSTRUMENTS } from '../../api/endpoints'
import type { InstrumentId } from '../../api/endpoints'
import { cn } from '../../lib/format'

interface InstrumentTabsProps {
  value: InstrumentId
  onChange: (id: InstrumentId) => void
  className?: string
}

/** NIFTY 50 / SENSEX segmented switcher reused across feature pages. */
export function InstrumentTabs({ value, onChange, className }: InstrumentTabsProps) {
  return (
    <div
      className={cn(
        'inline-flex rounded-lg border border-slate-200 bg-white p-1',
        className,
      )}
    >
      {INSTRUMENTS.map((inst) => {
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
