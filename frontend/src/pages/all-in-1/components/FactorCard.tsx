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
 * requirement. Renders a muted overlay when the factor is blocked on backend data.
 */
export function FactorCard({ module, reading }: FactorCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn(
        'card-interactive flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300',
        reading.blocked && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-base leading-none" aria-hidden>
          {module.icon}
        </span>
        {reading.blocked ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
            Soon
          </span>
        ) : (
          <BiasDot bias={reading.bias} />
        )}
      </div>

      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {module.index} · {module.title}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{reading.value}</div>
      <div className="mt-0.5 text-xs leading-snug text-slate-500">{reading.detail}</div>

      {open && reading.reasoning.length > 0 && (
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
