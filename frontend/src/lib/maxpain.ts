// Pure Max-Pain math — no React/API imports so it stays unit-testable.
//
// Max Pain = the expiry/settlement price at which the total intrinsic value of
// all open options (call + put) is MINIMISED — i.e. where option writers pay out
// the least and the largest cluster of buyers expires worthless. For each
// candidate settlement strike E:
//
//   callPain(E) = Σ_k call_oi[k] · max(0, E − strike[k])   (calls ITM below E)
//   putPain(E)  = Σ_k put_oi[k]  · max(0, strike[k] − E)   (puts  ITM above E)
//   totalPain(E) = callPain(E) + putPain(E)
//
// The Max Pain strike = argmin totalPain. Pain is OI(contracts) × index-points
// (no lot multiply); the argmin strike is invariant to that scaling.

export interface PainPoint {
  strike: number
  callPain: number
  putPain: number
  totalPain: number
}

export type MaxPainRegime = 'bullish' | 'bearish' | 'neutral'

export interface MaxPainSentiment {
  regime: MaxPainRegime
  /** 0–100, for the donut fill (50 = neutral). */
  bullishPct: number
  insight: string
}

/**
 * Per-strike pain curve. `strikes`, `callOi`, `putOi` are aligned arrays (same
 * index = same strike). Missing/null OI counts as 0. Output is sorted by strike
 * ascending. Each candidate settlement strike E is evaluated against the FULL
 * chain, so the result is the classic "V" (minimum at Max Pain, tall at the tails).
 */
export function computePainCurve(
  strikes: number[],
  callOi: (number | null)[],
  putOi: (number | null)[],
): PainPoint[] {
  const n = strikes.length
  // Index-sort so the settlement loop reads a strike-ascending chain regardless
  // of the caller's ordering.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => strikes[a] - strikes[b])
  const ks = order.map((i) => strikes[i])
  const c = order.map((i) => callOi[i] ?? 0)
  const p = order.map((i) => putOi[i] ?? 0)

  return ks.map((E) => {
    let callPain = 0
    let putPain = 0
    for (let k = 0; k < ks.length; k++) {
      if (ks[k] < E) callPain += c[k] * (E - ks[k]) // calls struck below E are ITM
      else if (ks[k] > E) putPain += p[k] * (ks[k] - E) // puts struck above E are ITM
    }
    return { strike: E, callPain, putPain, totalPain: callPain + putPain }
  })
}

/** Strike with the minimum total pain. Null for an empty curve. */
export function maxPainStrike(curve: PainPoint[]): number | null {
  if (curve.length === 0) return null
  let best = curve[0]
  for (const pt of curve) if (pt.totalPain < best.totalPain) best = pt
  return best.strike
}

/** Neutral band: |spot − maxPain| within this fraction of maxPain reads flat. */
const NEUTRAL_BAND = 0.001 // 0.1%
/** Distance→confidence scale: a 2% gap saturates the donut to ~100/0. */
const PCT_SCALE = 2500

/**
 * Directional read from spot vs the Max Pain "pin": price above max pain leans
 * bullish (dealers may let it drift up), below leans bearish. `bullishPct` maps
 * the gap onto a 0–100 donut fill (50 = at the pin).
 */
export function maxPainSentiment(spot: number, maxPain: number): MaxPainSentiment {
  if (!Number.isFinite(spot) || !Number.isFinite(maxPain) || maxPain <= 0) {
    return { regime: 'neutral', bullishPct: 50, insight: 'Max pain data unavailable.' }
  }
  const gap = (spot - maxPain) / maxPain
  const bullishPct = Math.max(0, Math.min(100, Math.round(50 + gap * PCT_SCALE)))

  if (gap > NEUTRAL_BAND) {
    return {
      regime: 'bullish',
      bullishPct,
      insight: 'Bullish bias with spot above the max pain level. Market may continue to push higher.',
    }
  }
  if (gap < -NEUTRAL_BAND) {
    return {
      regime: 'bearish',
      bullishPct,
      insight: 'Bearish bias with spot below the max pain level. Market may drift lower toward the pin.',
    }
  }
  return {
    regime: 'neutral',
    bullishPct,
    insight: 'Spot is pinned near the max pain level — expect range-bound, low-momentum action.',
  }
}
