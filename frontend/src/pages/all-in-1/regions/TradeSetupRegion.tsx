import type { TradeSetup } from '../allInOne.types'

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={accent ?? 'text-sm font-semibold text-slate-900'}>{value}</div>
    </div>
  )
}

/** The recommended-trade hero card — strategy, legs, levels, and the plan. */
export function TradeSetupRegion({ setup }: { setup: TradeSetup }) {
  return (
    <div className="rounded-xl border-2 border-primary-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span aria-hidden>🎯</span>
          Recommended trade setup
        </div>
        <span className="rounded-md bg-primary-100 px-3 py-1 text-xs font-medium text-primary-700">
          {setup.strategy}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Sell legs" value={setup.legs} />
        <Stat label="Net credit" value={setup.credit} accent="text-sm font-semibold text-emerald-600" />
        <Stat label="Stop loss" value={setup.stopLoss} accent="text-sm font-semibold text-rose-600" />
        <Stat label="Target" value={setup.target} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span>⚙️ Adjust: {setup.adjustment}</span>
        <span>🚪 Exit: {setup.exit}</span>
        <span>🪙 Size: {setup.sizing}</span>
      </div>
    </div>
  )
}
