import type { FactorModule } from './allInOne.types'

/**
 * The 20 analytical factors, in display order.
 *
 * P0: every `compute` returns a fixed mock reading so the page renders the
 * approved layout without a backend. P1 swaps each body to read the real
 * `ctx` (AllInOneContext). The 5 factors flagged `blocked: true` stay mocked
 * until their backend endpoints land (P2).
 */
export const FACTOR_MODULES: FactorModule[] = [
  {
    index: 1,
    id: 'price-action',
    title: 'Price action',
    icon: '📈',
    compute: () => ({
      value: 'Bullish · HH/HL',
      detail: 'Above breakout 25,100',
      bias: 1,
      reasoning: [
        'Higher highs and higher lows on the 15m structure.',
        'Trading above the 25,100 breakout zone with follow-through.',
      ],
    }),
  },
  {
    index: 2,
    id: 'support-resistance',
    title: 'Support / resistance',
    icon: '🧱',
    compute: () => ({
      value: 'R 25,400 · S 24,800',
      detail: 'Range band intact',
      bias: 0,
      reasoning: [
        'Major supply at 25,400, demand zone at 24,800.',
        'Price mid-band — no decisive break either side yet.',
      ],
    }),
  },
  {
    index: 3,
    id: 'open-interest',
    title: 'Open interest',
    icon: '🗃️',
    compute: () => ({
      value: 'Short covering',
      detail: 'Calls unwinding 25,500',
      bias: 1,
      reasoning: [
        'Call OI reducing at 25,500 — writers stepping back.',
        'Put additions at 24,800 supporting the floor.',
      ],
    }),
  },
  {
    index: 4,
    id: 'pcr',
    title: 'PCR',
    icon: '⚖️',
    compute: () => ({
      value: '1.24',
      detail: 'Mildly bullish',
      bias: 1,
      reasoning: ['PCR 1.24 — more puts than calls written, supportive bias.'],
    }),
  },
  {
    index: 5,
    id: 'max-pain',
    title: 'Max pain',
    icon: '🎯',
    compute: () => ({
      value: '25,000',
      detail: '118 pts below spot',
      bias: 0,
      reasoning: ['Max pain at 25,000 — mild downward gravitational pull into expiry.'],
    }),
  },
  {
    index: 6,
    id: 'magnet-zones',
    title: 'Magnet zones',
    icon: '🧲',
    compute: () => ({
      value: '25,000 / 25,500',
      detail: 'Heavy OI walls',
      bias: 0,
      reasoning: ['Largest OI concentrations form price magnets at 25,000 and 25,500.'],
    }),
  },
  {
    index: 7,
    id: 'iv',
    title: 'Implied vol',
    icon: '🌫️',
    compute: () => ({
      value: '12.4%',
      detail: 'Low-to-medium',
      bias: 0,
      reasoning: ['ATM IV 12.4% — premiums modest, favours sellers only selectively.'],
    }),
  },
  {
    index: 8,
    id: 'iv-rank',
    title: 'IV rank',
    icon: '📊',
    compute: () => ({
      value: 'IVR 28',
      detail: 'Premiums on cheap side',
      bias: 0,
      reasoning: ['IV rank 28 (approx via percentile) — true IVR needs IV history (P2).'],
    }),
  },
  {
    index: 9,
    id: 'greeks',
    title: 'Greeks',
    icon: '🔢',
    compute: () => ({
      value: 'Δ +0.12 · Θ high',
      detail: 'Net theta positive',
      bias: 1,
      reasoning: ['Greeks require an options analytics endpoint — backend gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 10,
    id: 'india-vix',
    title: 'India VIX',
    icon: '🔥',
    compute: () => ({
      value: '13.2',
      detail: 'Low fear / complacent',
      bias: 0,
      reasoning: ['VIX 13.2 — calm regime, low premium but lower tail risk.'],
    }),
  },
  {
    index: 11,
    id: 'gex',
    title: 'GEX',
    icon: '🛡️',
    compute: () => ({
      value: 'Positive',
      detail: 'Vol suppressed, pinned',
      bias: 0,
      reasoning: ['Gamma exposure requires a backend computation — gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 12,
    id: 'volume-profile',
    title: 'Volume profile',
    icon: '📶',
    compute: () => ({
      value: 'POC 25,120',
      detail: 'Acceptance zone',
      bias: 0,
      reasoning: ['POC / VAH / VAL require a volume-profile endpoint — gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 13,
    id: 'vwap',
    title: 'VWAP',
    icon: '〰️',
    compute: () => ({
      value: 'Above VWAP',
      detail: 'Institutional buy bias',
      bias: 1,
      reasoning: ['VWAP requires intraday tick aggregation — backend gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 14,
    id: 'atr',
    title: 'ATR',
    icon: '↕️',
    compute: () => ({
      value: '182 pts',
      detail: 'Expected daily range',
      bias: 0,
      reasoning: ['ATR requires historical OHLC — backend gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 15,
    id: 'expected-move',
    title: 'Expected move',
    icon: '↔️',
    compute: () => ({
      value: '±210 pts',
      detail: 'ATM straddle implied',
      bias: 0,
      reasoning: ['Derived from the ATM straddle premium — computed from the chain.'],
    }),
  },
  {
    index: 16,
    id: 'liquidity',
    title: 'Liquidity',
    icon: '💧',
    compute: () => ({
      value: 'Tight spreads',
      detail: 'Highly tradable',
      bias: 1,
      reasoning: ['High volume; bid-ask spread enrichment pending (partial — P2).'],
    }),
  },
  {
    index: 17,
    id: 'event-risk',
    title: 'Event risk',
    icon: '📅',
    compute: () => ({
      value: 'FED · Wed',
      detail: 'Elevated vol risk',
      bias: -1,
      reasoning: ['Economic calendar feed required — backend gap (P2).'],
      blocked: true,
    }),
  },
  {
    index: 18,
    id: 'risk-reward',
    title: 'Risk / reward',
    icon: '🎚️',
    compute: () => ({
      value: '1 : 1.8',
      detail: 'Acceptable quality',
      bias: 0,
      reasoning: ['Reward 1.8× risk on the recommended setup — acceptable, not premium.'],
    }),
  },
  {
    index: 19,
    id: 'position-sizing',
    title: 'Position size',
    icon: '🪙',
    compute: () => ({
      value: '2% · 3 lots',
      detail: 'Conservative alloc',
      bias: 0,
      reasoning: ['Risk capped at 2% of capital → 3 lots at the suggested SL.'],
    }),
  },
  {
    index: 20,
    id: 'trading-decision',
    title: 'Trading decision',
    icon: '🧭',
    compute: () => ({
      value: 'Sell premium',
      detail: 'Range-bound strangle',
      bias: 1,
      reasoning: ['Net read favours a defined range — sell premium via short strangle.'],
    }),
  },
]
