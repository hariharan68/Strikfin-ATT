// Pure Gamma Exposure (GEX) math — no React/API imports so it stays unit-testable.
//
// Conventions (dealer-positioning model):
//   - Dealers are net SHORT calls and LONG puts, so call gamma exposure is
//     positive (vol-dampening) and put gamma exposure is negative.
//   - GEX per leg = gamma * OI * lotSize * spot^2 * 0.01
//     (rupee-notional per 1% spot move — the industry-standard GEX convention,
//     matching StockMojo and SqueezeMetrics-style dashboards).
//   - Display scaling is Crore (÷ 1e7) via toCrore().

export interface GexLegInput {
  oi: number | null
  /** implied volatility in percent (e.g. 12.5), null when unrecoverable */
  iv: number | null
}

export interface GexStrikeInput {
  strike: number
  call: GexLegInput
  put: GexLegInput
}

/** Per-strike gamma exposure, in rupees (unscaled). */
export interface StrikeGEX {
  strike: number
  callGEX: number
  putGEX: number
  netGEX: number
  absGEX: number
}

export const DEFAULT_RISK_FREE = 0.065
export const CRORE = 1e7

/** Hours in an average year (365.25 * 24). */
const HOURS_PER_YEAR = 8766

/** Standard normal probability density. */
export function normPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI)
}

/** Calendar time to expiry in years (hours / 8766), clamped to >= 0. */
export function yearsToExpiry(snapTsIso: string, expiryTsIso: string): number {
  const snap = Date.parse(snapTsIso)
  const exp = Date.parse(expiryTsIso)
  if (!Number.isFinite(snap) || !Number.isFinite(exp)) return 0
  const hours = (exp - snap) / 3_600_000
  return Math.max(0, hours / HOURS_PER_YEAR)
}

/**
 * Black-Scholes gamma (identical for calls and puts).
 * Returns null when the inputs cannot produce a finite gamma
 * (expired, missing/zero IV, non-positive spot/strike).
 */
export function bsGamma(
  spot: number,
  strike: number,
  ivPct: number | null,
  tYears: number,
  r: number = DEFAULT_RISK_FREE,
): number | null {
  if (ivPct == null || ivPct <= 0) return null
  if (tYears <= 0 || spot <= 0 || strike <= 0) return null
  const sigma = ivPct / 100
  const sqrtT = Math.sqrt(tYears)
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * tYears) / (sigma * sqrtT)
  const gamma = normPdf(d1) / (spot * sigma * sqrtT)
  return Number.isFinite(gamma) ? gamma : null
}

/**
 * Per-strike dealer GEX. Legs with missing OI or unrecoverable gamma
 * contribute 0 (the other leg still counts). Result sorted by strike asc.
 */
export function computeStrikeGEX(
  rows: GexStrikeInput[],
  spot: number,
  lotSize: number,
  tYears: number,
  r: number = DEFAULT_RISK_FREE,
): StrikeGEX[] {
  // Per-1%-move scaling: spot^2 * (1%)^... => spot^2 * 0.01 (standard GEX $/1% move).
  const spot2 = spot * spot * 0.01
  const out: StrikeGEX[] = rows.map((row) => {
    const cGamma = bsGamma(spot, row.strike, row.call.iv, tYears, r)
    const pGamma = bsGamma(spot, row.strike, row.put.iv, tYears, r)
    const callGEX =
      cGamma != null && row.call.oi != null ? cGamma * row.call.oi * lotSize * spot2 : 0
    const putGEX =
      pGamma != null && row.put.oi != null ? -(pGamma * row.put.oi * lotSize * spot2) : 0
    return {
      strike: row.strike,
      callGEX,
      putGEX,
      netGEX: callGEX + putGEX,
      absGEX: Math.abs(callGEX) + Math.abs(putGEX),
    }
  })
  out.sort((a, b) => a.strike - b.strike)
  return out
}

/** Totals across strikes (rupees). */
export function aggregate(rows: StrikeGEX[]): { netGEX: number; absGEX: number } {
  let net = 0
  let abs = 0
  for (const r of rows) {
    net += r.netGEX
    abs += r.absGEX
  }
  return { netGEX: net, absGEX: abs }
}

/**
 * Call Wall = strike with the largest CALL-side gamma exposure; Put Wall =
 * strike with the largest PUT-side gamma exposure (by magnitude). This is the
 * standard SpotGamma/StockMojo definition — the biggest single-side gamma pin,
 * NOT the max/min NET GEX (which over-weights strikes where the opposite side
 * is thin). Null when that side has no gamma.
 */
export function computeWalls(rows: StrikeGEX[]): {
  callWall: number | null
  putWall: number | null
} {
  let callWall: number | null = null
  let putWall: number | null = null
  let maxCall = 0
  let maxPut = 0
  for (const r of rows) {
    if (r.callGEX > maxCall) {
      maxCall = r.callGEX
      callWall = r.strike
    }
    // putGEX is ≤ 0 (dealer short-put convention) — compare magnitude.
    const putMag = -r.putGEX
    if (putMag > maxPut) {
      maxPut = putMag
      putWall = r.strike
    }
  }
  return { callWall, putWall }
}

/**
 * Net GEX Cross: the price where the per-strike NET GEX profile crosses zero,
 * linearly interpolated between the two adjacent strikes whose net GEX changes
 * sign. When several crossings exist, returns the one nearest `spot` (the main
 * put→call handover near the money). Null when the profile never changes sign.
 */
export function computeNetGexCross(rows: StrikeGEX[], spot?: number): number | null {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  const crossings: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].netGEX
    const b = sorted[i + 1].netGEX
    if (a === 0) {
      crossings.push(sorted[i].strike)
      continue
    }
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const k0 = sorted[i].strike
      const k1 = sorted[i + 1].strike
      crossings.push(k0 + ((k1 - k0) * (0 - a)) / (b - a))
    }
  }
  if (crossings.length === 0) return null
  if (spot == null) return crossings[0]
  return crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best), crossings[0])
}

/**
 * Zero-Gamma / Gamma Flip: the hypothetical SPOT price at which TOTAL dealer net
 * GEX flips sign — recomputing every strike's Black-Scholes gamma at each
 * candidate spot, then bisecting the sign change. Unlike a cumulative
 * across-strike sum, this level exists even when today's net GEX is one-signed
 * (short gamma at the current spot but long gamma higher up). Null when total
 * net GEX keeps the same sign across the whole strike range.
 */
export function computeZeroGamma(
  rows: GexStrikeInput[],
  lotSize: number,
  tYears: number,
  r: number = DEFAULT_RISK_FREE,
): number | null {
  const strikes = rows.map((x) => x.strike).filter((s) => s > 0).sort((a, b) => a - b)
  if (strikes.length < 2 || tYears <= 0) return null

  const netAt = (S: number): number => {
    let net = 0
    const s2 = S * S * 0.01
    for (const row of rows) {
      const cG = bsGamma(S, row.strike, row.call.iv, tYears, r)
      const pG = bsGamma(S, row.strike, row.put.iv, tYears, r)
      if (cG != null && row.call.oi != null) net += cG * row.call.oi * lotSize * s2
      if (pG != null && row.put.oi != null) net -= pG * row.put.oi * lotSize * s2
    }
    return net
  }

  const lo = strikes[0]
  const hi = strikes[strikes.length - 1]
  const STEPS = 160
  let prevS = lo
  let prevV = netAt(lo)
  for (let i = 1; i <= STEPS; i++) {
    const S = lo + ((hi - lo) * i) / STEPS
    const v = netAt(S)
    if (prevV === 0) return prevS
    if ((prevV < 0 && v > 0) || (prevV > 0 && v < 0)) {
      // Bisect the [prevS, S] bracket for the exact zero.
      let a = prevS
      let b = S
      let fa = prevV
      for (let k = 0; k < 48; k++) {
        const m = (a + b) / 2
        const fm = netAt(m)
        if (fm === 0) return m
        if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) {
          a = m
          fa = fm
        } else {
          b = m
        }
      }
      return (a + b) / 2
    }
    prevS = S
    prevV = v
  }
  return null
}

export function gexRegime(netGEX: number): 'long-gamma' | 'short-gamma' {
  return netGEX >= 0 ? 'long-gamma' : 'short-gamma'
}

/** Rupees → Crore. */
export function toCrore(v: number): number {
  return v / CRORE
}
