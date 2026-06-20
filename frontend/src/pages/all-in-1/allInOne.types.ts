import type {
  BiasValue,
  IndexSnapshot,
  IndexLevels,
  OptionsMetrics,
  OptionChainRow,
  RegimeData,
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
  regime?: RegimeData
  signal?: SignalData
  smartMoney?: SmartMoneyData
  institutional?: InstitutionalData
  sentiment?: SentimentData
  shortCovering?: ShortCoveringData
}

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
  /** True when the underlying data isn't available yet (backend gap). */
  blocked?: boolean
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
