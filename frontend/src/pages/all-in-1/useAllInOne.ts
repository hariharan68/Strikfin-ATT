import { useMemo } from 'react'
import type { InstrumentId } from '../../api/endpoints'
import type { AllInOneContext, AllInOneViewModel } from './allInOne.types'
import { FACTOR_MODULES } from './factorRegistry'

/**
 * Assembles the All-in-1 view-model.
 *
 * P0: returns a synchronously-built mock view-model so the page renders the
 * approved layout with no backend. The factor readings already run through the
 * real registry contract (FactorModule.compute), proving the architecture.
 *
 * P1: replace the mock context with a fetch of `GET /all-in-1/{id}` (via
 * useFetch) and derive `verdict` / `tradeSetup` / `keyLevels` from the response.
 */
export function useAllInOne(_instrument: InstrumentId): {
  data: AllInOneViewModel
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const data = useMemo<AllInOneViewModel>(() => {
    const ctx: AllInOneContext = {} // P0 mock — compute() returns fixed readings

    const factors = FACTOR_MODULES.map((module) => ({
      module,
      reading: module.compute(ctx),
    }))

    return {
      verdict: {
        bias: 1,
        label: 'Bullish',
        confidence: 68,
        pop: 74,
        risk: 'Medium',
      },
      tradeSetup: {
        strategy: 'Short strangle',
        legs: '25,500 CE / 24,700 PE',
        credit: '₹148',
        stopLoss: '₹222 (1.5×)',
        target: '50% premium',
        adjustment: 'Roll the untested leg on a breach',
        exit: 'T-1 or 50% premium decay',
        sizing: '2% capital · 3 lots',
      },
      keyLevels: {
        resistance: [25600, 25400],
        support: [24800, 24600],
        maxPain: 25000,
        poc: 25120,
      },
      factors,
    }
  }, [])

  return { data, loading: false, error: null, refetch: () => {} }
}
