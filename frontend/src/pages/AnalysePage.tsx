import { useSearchParams } from 'react-router-dom'
import { Construction } from 'lucide-react'
import { Panel } from '../components/ui/Panel'

// Slug → label map (mirrors the Analyse mega-menu in the navbar).
const ANALYSE_LABELS: Record<string, string> = {
  'fii-dii-summary': 'FII/DII Summary',
  'fii-dii-cash-market': 'FII/DII Cash Market',
}

export function AnalysePage() {
  const [params] = useSearchParams()
  const tool = params.get('tool') || 'fii-dii-summary'
  const label = ANALYSE_LABELS[tool] ?? 'Analyse'

  return (
    <Panel>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
          <Construction size={32} strokeWidth={1.75} />
        </span>
        <span className="mb-2 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
          Under Development
        </span>
        <h2 className="text-xl font-bold text-slate-800">
          <span className="text-primary-600">{label}</span>
        </h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          This Analyse module is still being built. We're rolling out the full
          FII / DII participant analytics suite — check back soon.
        </p>
      </div>
    </Panel>
  )
}
