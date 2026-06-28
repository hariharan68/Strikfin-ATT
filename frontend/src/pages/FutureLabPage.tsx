import { useSearchParams } from 'react-router-dom'
import { Construction } from 'lucide-react'
import { Panel } from '../components/ui/Panel'

// Slug → label map (mirrors the Future Lab mega-menu in the navbar).
const FUTURE_LAB_LABELS: Record<string, string> = {
  'future-dashboard': 'Future Dashboard',
  'market-movers': 'Market Movers',
  'future-heatmap': 'Future Heatmap',
  'future-intraday': 'Future Intraday',
  'price-vs-oi': 'Price vs OI',
  'future-sentiment-cycle': 'Future Sentiment Cycle',
}

export function FutureLabPage() {
  const [params] = useSearchParams()
  const tool = params.get('tool') || 'future-dashboard'
  const label = FUTURE_LAB_LABELS[tool] ?? 'Future Lab'

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
          This Future Lab module is still being built. We're rolling out the full
          futures analytics toolkit — check back soon.
        </p>
      </div>
    </Panel>
  )
}
