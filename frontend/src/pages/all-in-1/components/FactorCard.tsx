import { useState } from 'react'
import type { FactorModule, FactorReading } from '../allInOne.types'
import { BiasDot } from './BiasDot'
import { cn } from '../../../lib/format'

interface FactorCardProps {
  module: FactorModule
  reading: FactorReading
}

/**
 * Shared tile shell for every one of the 20 factors. Click to expand the
 * "reasoning" panel — this is the surface for the "explain every conclusion"
 * requirement. Renders a muted overlay when the factor is blocked on backend
 * data, and a per-card loading / "Unavailable" state driven by its live feed —
 * a wrong trading value is worse than one clearly marked loading or unavailable.
 */
export function FactorCard({ module, reading }: FactorCardProps) {
  const [open, setOpen] = useState(false)

  const isLoading = reading.status === 'loading'
  const isError = reading.status === 'error'
  const isDegraded = isLoading || isError

  // Headline + sub-line content, overridden when the feed isn't usable.
  const value = isLoading ? 'Loading…' : isError ? 'Unavailable' : reading.value
  const detail = isLoading
    ? 'Fetching live data'
    : isError
      ? 'Feed unavailable — value withheld'
      : reading.detail

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn(
        'card-interactive flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300',
        (reading.blocked || isLoading) && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-slate-500" aria-hidden>
          <module.icon size={18} strokeWidth={2} />
        </span>
        {reading.blocked ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
            Soon
          </span>
        ) : isLoading ? (
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-slate-300" aria-hidden />
        ) : isError ? (
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
        ) : (
          <BiasDot bias={reading.bias} />
        )}
      </div>

      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {module.index} · {module.title}
      </div>
      <div className={cn('mt-0.5 text-sm font-semibold', isDegraded ? 'text-slate-400' : 'text-slate-900')}>
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-snug text-slate-500">{detail}</div>

      {open && !isDegraded && reading.reasoning.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-500">
          {reading.reasoning.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-primary-400">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  )
}
