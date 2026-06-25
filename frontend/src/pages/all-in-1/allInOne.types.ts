import type {
  BiasValue,
  IndexSnapshot,
  IndexLevels,
  OptionsMetrics,
  OptionChainRow,
  SignalData,
  SmartMoneyData,
  InstitutionalData,
  SentimentData,
  ShortCoveringData,
} from '../../api/endpoints'

/**
 * Everything a factor module needs to compute its reading. Built once per
 * instrument by `useAllInOne` (from the aggregated /all-in-1/{id} endpoint in
 * P1+, mock data in P0) and passed to every FactorModule.compute().
 */
export interface AllInOneContext {
  snapshot?: IndexSnapshot
  levels?: IndexLevels
  optionsMetrics?: OptionsMetrics
  chain?: OptionChainRow[]
  signal?: SignalData
  smartMoney?: SmartMoneyData
  institutional?: InstitutionalData
  sentiment?: SentimentData
  shortCovering?: ShortCoveringData
}

/**
 * Which live feed(s) a factor reads from. `useAllInOne` fetches each source
 * once per instrument and derives a per-card status from these keys so a single
 * failed/slow feed only degrades the cards that depend on it.
 */
export type SourceKey = 'snapshot' | 'levels' | 'optionsMetrics' | 'chain' | 'signal'

/**
 * Live-data status for one factor card.
 * - `ok`        — its feed(s) returned data; show the computed reading.
 * - `loading`   — first load of a feed it needs is still in flight.
 * - `error`     — a feed it needs failed and has no data → show "Unavailable",
 *                 never a stale/blank value.
 */
export type FactorStatus = 'ok' | 'loading' | 'error'

/** The output of one factor's analysis — drives a single FactorCard tile. */
export interface FactorReading {
  /** Headline metric, e.g. "1.24". */
  value: string
  /** One-line interpretation, e.g. "Mildly bullish". */
  detail: string
  /** -1 bearish / 0 neutral / 1 bullish → status dot colour. */
  bias: BiasValue
  /** Expandable "explain the reasoning" bullet points. */
  reasoning: string[]
  /** True when the underlying data isn't available yet (backend gap → "Soon"). */
  blocked?: boolean
  /**
   * Live-feed status, attached by `useAllInOne` for active (non-blocked)
   * factors. Undefined for blocked "Soon" cards, which never fetch.
   */
  status?: FactorStatus
}

/**
 * The unit of work. Each of the 20 factors implements this contract
 * independently against the shared context.
 */
export interface FactorModule {
  /** 1..20 — display order and label prefix. */
  index: number
  id: string
  title: string
  /** Emoji or short glyph shown on the tile. */
  icon: string
  /**
   * Live feeds this factor reads. The card's status is derived from these:
   * `loading` while any is first-loading, `error` if any failed with no data,
   * else `ok`. Omitted for blocked "Soon" cards (they never fetch).
   */
  sources?: SourceKey[]
  compute: (ctx: AllInOneContext) => FactorReading
}

/** Factor 20 — the overall trading decision shown in the verdict strip. */
export interface Verdict {
  bias: BiasValue
  label: string
  /** 0–100. */
  confidence: number
  /** Probability of profit, 0–100. */
  pop: number
  risk: 'Low' | 'Medium' | 'High'
}

export interface TradeSetup {
  strategy: string
  legs: string
  credit: string
  stopLoss: string
  target: string
  adjustment: string
  exit: string
  sizing: string
}

export interface KeyLevels {
  resistance: number[]
  support: number[]
  maxPain?: number
  poc?: number
}

/** The fully-assembled view-model the page renders. */
export interface AllInOneViewModel {
  verdict: Verdict
  tradeSetup: TradeSetup
  keyLevels: KeyLevels
  factors: Array<{ module: FactorModule; reading: FactorReading }>
}
