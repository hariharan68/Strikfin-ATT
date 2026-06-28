import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { AllInOneViewModel } from '../allInOne.types'

type FactorEntry = AllInOneViewModel['factors'][number]

function Column({
  title,
  Icon,
  accent,
  items,
}: {
  title: string
  Icon: LucideIcon
  accent: string
  items: FactorEntry[]
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${accent}`}>
        <Icon size={15} aria-hidden />
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">None.</p>
      ) : (
        <ul className="space-y-1.5 text-xs text-slate-600">
          {items.map(({ module, reading }) => (
            <li key={module.id} className="flex gap-1.5">
              <span className="text-slate-300">•</span>
              <span className="truncate" title={`${module.title} — ${reading.detail}`}>
                <span className="font-medium text-slate-700">{module.title}</span> — {reading.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Three columns bucketing every factor by its bias. */
export function FactorBreakdownRegion({ factors }: { factors: FactorEntry[] }) {
  const bullish = factors.filter((f) => f.reading.bias > 0)
  const bearish = factors.filter((f) => f.reading.bias < 0)
  const neutral = factors.filter((f) => f.reading.bias === 0)

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Column title="Bullish factors" Icon={TrendingUp} accent="text-emerald-600" items={bullish} />
      <Column title="Bearish factors" Icon={TrendingDown} accent="text-rose-600" items={bearish} />
      <Column title="Neutral factors" Icon={Minus} accent="text-amber-600" items={neutral} />
    </div>
  )
}
