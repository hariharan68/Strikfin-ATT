import { useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, LineChart, Scale, Flame, Hexagon, FlaskConical } from 'lucide-react'
import { cn } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { OpenInterestTool } from './options-lab/OpenInterestTool'
import { MultiOiVolumeTool } from './options-lab/MultiOiVolumeTool'


// ── OI Tools sub-navigation (matches the navbar's OI TOOLS section) ──
const OI_TOOLS: { slug: string; label: string; Icon: LucideIcon; isNew?: boolean }[] = [
  { slug: 'open-interest', label: 'Open Interest', Icon: BarChart3 },
  { slug: 'multi-oi-volume', label: 'Multi OI & Volume', Icon: LineChart },
  { slug: 'put-call-ratio', label: 'Put-Call Ratio', Icon: Scale },
  { slug: 'max-pain', label: 'Max Pain', Icon: Flame },
  { slug: 'gamma-exposure', label: 'Gamma Exposure', Icon: Hexagon, isNew: true },
]

const OI_SLUGS = new Set(OI_TOOLS.map((t) => t.slug))

const ALL_TOOL_LABELS: Record<string, string> = {
  ...Object.fromEntries(OI_TOOLS.map((t) => [t.slug, t.label])),
  'timeseries': 'Timeseries',
  'strategy-chart': 'Strategy Chart',
  'smart-oi': 'Smart OI',
  'vega-analysis': 'Vega Analysis',
  'pe-ce-difference': 'PE-CE Difference',
  'atm-straddle-chart': 'ATM Straddle Chart',
  'premium-decay': 'Premium Decay',
  'price-vs-oi': 'Price vs OI',
  'multistrike-chart': 'MultiStrike Chart',
  'multi-straddle-chart': 'Multi-Straddle Chart',
  'volatility-skew': 'Volatility Skew',
  'iv-hv-ivp-chart': 'IV/HV/IVP Chart',
  'iv-hv': 'IV - HV',
  'iv-grid': 'IV Grid',
  'iv-intraday': 'IV - Intraday',
  'oi-crossover': 'OI Crossover',
  'intraday-booster': 'Intraday Booster',
  'option-triggers': 'Option Triggers',
}

export function OptionsLabPage() {
  const [params, setParams] = useSearchParams()
  const tool = params.get('tool') || 'open-interest'

  const selectTool = (slug: string) => {
    const next = new URLSearchParams(params)
    next.set('tool', slug)
    setParams(next, { replace: true })
  }

  const isOiTool = OI_SLUGS.has(tool)

  return (
    <div>
      {/* OI Tools sub-tab bar */}
      {isOiTool && (
        <div className="mb-5 flex flex-wrap justify-center gap-1.5">
          {OI_TOOLS.map((t) => (
            <button
              key={t.slug}
              onClick={() => selectTool(t.slug)}
              className={cn(
                'press inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors',
                tool === t.slug
                  ? 'border-primary-300 bg-primary-50 text-primary-700'
                  : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800',
              )}
            >
              <t.Icon size={18} strokeWidth={2} aria-hidden />
              {t.label}
              {t.isNew && (
                <span className="rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold uppercase text-white">New</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tool content */}
      {tool === 'open-interest' ? (
        <OpenInterestTool />
      ) : tool === 'multi-oi-volume' ? (
        <MultiOiVolumeTool />
      ) : (
        <ComingSoon label={ALL_TOOL_LABELS[tool] ?? 'Options Lab'} />
      )}
    </div>
  )
}

function ComingSoon({ label }: { label: string }) {
  return (
    <Panel>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FlaskConical size={48} className="mb-4 text-slate-300" strokeWidth={1.5} />
        <h2 className="text-xl font-bold text-slate-800">Coming Soon</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          <span className="font-semibold text-primary-600">{label}</span> is under development. We're
          building out the full Options Lab toolkit — check back soon.
        </p>
      </div>
    </Panel>
  )
}
