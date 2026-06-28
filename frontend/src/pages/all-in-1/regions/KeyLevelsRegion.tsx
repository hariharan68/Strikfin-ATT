import { BrickWall } from 'lucide-react'
import type { KeyLevels } from '../allInOne.types'
import { formatInt, cn } from '../../../lib/format'

function Level({ label, value, tone }: { label: string; value?: number; tone: string }) {
  return (
    <div className="text-center">
      <div className={cn('text-[11px] font-medium', tone)}>{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value != null ? formatInt(value) : '—'}</div>
    </div>
  )
}

/** Horizontal ladder of the key levels to watch. */
export function KeyLevelsRegion({ levels }: { levels: KeyLevels }) {
  const [r1, r2] = levels.resistance // [nearest, far] — display far→near
  const [s1, s2] = levels.support

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <BrickWall size={15} aria-hidden />
        Key levels to watch
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <Level label="R2" value={r2} tone="text-rose-600" />
        <Level label="R1" value={r1} tone="text-rose-600" />
        <Level label="Max pain" value={levels.maxPain} tone="text-primary-600" />
        <Level label="POC" value={levels.poc} tone="text-slate-500" />
        <Level label="S1" value={s1} tone="text-emerald-600" />
        <Level label="S2" value={s2} tone="text-emerald-600" />
      </div>
    </div>
  )
}
