import { useInstrument } from '../../lib/useInstrument'
import { InstrumentTabs } from '../../components/ui/InstrumentTabs'
import { LiveClock } from '../../components/ui/LiveClock'
import { PageHeader } from '../../components/ui/Page'
import { useAllInOne } from './useAllInOne'
import { VerdictRegion } from './regions/VerdictRegion'
import { TradeSetupRegion } from './regions/TradeSetupRegion'
import { FactorBreakdownRegion } from './regions/FactorBreakdownRegion'
import { KeyLevelsRegion } from './regions/KeyLevelsRegion'
import { FactorCard } from './components/FactorCard'

/**
 * "All in 1" — institutional 20-factor options & trading analysis.
 * P0 scaffold: renders the approved layout from a mock view-model.
 */
export function AllInOnePage() {
  const [instrument, setInstrument] = useInstrument()
  const { data } = useAllInOne(instrument)

  return (
    <div className="space-y-6">
      <PageHeader
        title="All in 1"
        subtitle="20-factor options & trading analysis"
        right={
          <>
            <InstrumentTabs value={instrument} onChange={setInstrument} />
            <LiveClock />
          </>
        }
      />

      <VerdictRegion verdict={data.verdict} />
      <TradeSetupRegion setup={data.tradeSetup} />
      <FactorBreakdownRegion factors={data.factors} />
      <KeyLevelsRegion levels={data.keyLevels} />

      <div>
        <div className="mb-3 text-sm font-semibold text-slate-600">20-factor analysis grid</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.factors.map(({ module, reading }) => (
            <FactorCard key={module.id} module={module} reading={reading} />
          ))}
        </div>
      </div>
    </div>
  )
}
