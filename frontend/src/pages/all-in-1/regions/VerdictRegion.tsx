import type { Verdict } from '../allInOne.types'
import { biasToTone, toneClasses, cn } from '../../../lib/format'

const RISK_TONE: Record<Verdict['risk'], string> = {
  Low: 'bg-emerald-50 text-emerald-700',
  Medium: 'bg-amber-50 text-amber-700',
  High: 'bg-rose-50 text-rose-700',
}

/** Top strip — the at-a-glance answer: bias, confidence, POP, risk (factor 20). */
export function VerdictRegion({ verdict }: { verdict: Verdict }) {
  const tone = toneClasses[biasToTone(verdict.bias)]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className={cn('rounded-xl p-4', tone.soft)}>
        <div className="text-xs font-medium">Overall bias</div>
        <div className="mt-1 text-2xl font-bold tracking-tight">{verdict.label}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium text-slate-500">Confidence</div>
        <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {verdict.confidence}
          <span className="text-sm font-medium text-slate-400">/100</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${verdict.confidence}%` }} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium text-slate-500">Probability of profit</div>
        <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{verdict.pop}%</div>
        <div className="text-xs text-slate-400">Recommended setup POP</div>
      </div>

      <div className={cn('rounded-xl p-4', RISK_TONE[verdict.risk])}>
        <div className="text-xs font-medium">Risk level</div>
        <div className="mt-1 text-2xl font-bold tracking-tight">{verdict.risk}</div>
      </div>
    </div>
  )
}
