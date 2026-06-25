import { useMemo } from 'react'
import type { InstrumentId } from '../../api/endpoints'
import {
  getSnapshot,
  getLevels,
  getOptionsMetrics,
  getOptionsChain,
  getLatestSignal,
} from '../../api/endpoints'
import { useFetch } from '../../lib/useFetch'
import type {
  AllInOneContext,
  AllInOneViewModel,
  FactorStatus,
  SourceKey,
} from './allInOne.types'
import { FACTOR_MODULES } from './factorRegistry'

/** Poll cadence — matches the options-heavy OI / Smart Money pages. */
const POLL_MS = 15_000

/**
 * Assembles the All-in-1 view-model from live data.
 *
 * Composes the existing per-domain endpoints (snapshot, levels, option metrics,
 * chain, latest signal) on the client — there is no aggregate `/all-in-1`
 * endpoint. Each feed is fetched + polled independently so a single slow/failed
 * feed only degrades the cards that depend on it, never the whole grid.
 *
 * The 6 "Soon" factors (Greeks, GEX, Volume Profile, VWAP, ATR, Event Risk)
 * have no feed and stay static. POC in the key-levels strip has no source
 * (Volume Profile gap) and is intentionally left undefined → renders "—".
 */
export function useAllInOne(instrument: InstrumentId): {
  data: AllInOneViewModel
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const snapshot = useFetch(() => getSnapshot(instrument), [instrument], { intervalMs: POLL_MS })
  const levels = useFetch(() => getLevels(instrument), [instrument], { intervalMs: POLL_MS })
  const optionsMetrics = useFetch(() => getOptionsMetrics(instrument), [instrument], { intervalMs: POLL_MS })
  const chain = useFetch(() => getOptionsChain(instrument), [instrument], { intervalMs: POLL_MS })
  const signal = useFetch(() => getLatestSignal(instrument), [instrument], { intervalMs: POLL_MS })

  const data = useMemo<AllInOneViewModel>(() => {
    const ctx: AllInOneContext = {
      snapshot: snapshot.data ?? undefined,
      levels: levels.data ?? undefined,
      optionsMetrics: optionsMetrics.data ?? undefined,
      chain: chain.data ?? undefined,
      signal: signal.data ?? undefined,
    }

    // Per-feed status: `ok` once data has arrived (last-good retained across a
    // failed refresh), `error` if it failed before ever loading, else `loading`.
    const statusOf = (s: { data: unknown; error: string | null }): FactorStatus =>
      s.data != null ? 'ok' : s.error ? 'error' : 'loading'

    const sourceStatus: Record<SourceKey, FactorStatus> = {
      snapshot: statusOf(snapshot),
      levels: statusOf(levels),
      optionsMetrics: statusOf(optionsMetrics),
      chain: statusOf(chain),
      signal: statusOf(signal),
    }

    /** A card is loading if any feed it needs is still first-loading, error if
     *  any failed with no data, else ok. */
    const factorStatus = (sources: SourceKey[]): FactorStatus => {
      const states = sources.map((k) => sourceStatus[k])
      if (states.some((s) => s === 'loading')) return 'loading'
      if (states.some((s) => s === 'error')) return 'error'
      return 'ok'
    }

    const factors = FACTOR_MODULES.map((module) => {
      const reading = module.compute(ctx)
      // Blocked "Soon" cards never fetch — leave them as-is (no status).
      if (reading.blocked || !module.sources?.length) return { module, reading }
      return { module, reading: { ...reading, status: factorStatus(module.sources) } }
    })

    const om = optionsMetrics.data
    const lv = levels.data
    const resistance = lv?.resistance ?? (om?.resistance != null ? [om.resistance] : [])
    const support = lv?.support ?? (om?.support != null ? [om.support] : [])

    return {
      // Verdict + trade setup strips are out of scope for live wiring (P1) and
      // stay as the approved placeholder until separately wired.
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
        resistance,
        support,
        maxPain: om?.max_pain,
        // POC has no live source (Volume Profile gap) — leave undefined → "—".
        poc: undefined,
      },
      factors,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshot.data, snapshot.error,
    levels.data, levels.error,
    optionsMetrics.data, optionsMetrics.error,
    chain.data, chain.error,
    signal.data, signal.error,
  ])

  const loading =
    snapshot.loading && levels.loading && optionsMetrics.loading && chain.loading && signal.loading
  const error =
    snapshot.error ?? levels.error ?? optionsMetrics.error ?? chain.error ?? signal.error ?? null
  const refetch = () => {
    snapshot.refetch()
    levels.refetch()
    optionsMetrics.refetch()
    chain.refetch()
    signal.refetch()
  }

  return { data, loading, error, refetch }
}
