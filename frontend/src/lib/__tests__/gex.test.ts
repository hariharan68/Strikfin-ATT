import { describe, expect, it } from 'vitest'

import {
  aggregate,
  bsGamma,
  computeNetGexCross,
  computeStrikeGEX,
  computeWalls,
  computeZeroGamma,
  gexRegime,
  normPdf,
  toCrore,
  yearsToExpiry,
  type GexStrikeInput,
  type StrikeGEX,
} from '../gex'

const leg = (oi: number | null, iv: number | null) => ({ oi, iv })

const row = (strike: number, callGEX: number, putGEX: number): StrikeGEX => ({
  strike,
  callGEX,
  putGEX,
  netGEX: callGEX + putGEX,
  absGEX: Math.abs(callGEX) + Math.abs(putGEX),
})

describe('bsGamma', () => {
  it('matches the hand-computed Black-Scholes value at the money', () => {
    // S=100, K=100, iv=20%, T=0.25, r=0.065:
    // d1 = (0 + (0.065 + 0.02)·0.25) / (0.2·0.5) = 0.2125
    // gamma = pdf(0.2125) / (100·0.2·0.5) ≈ 0.0390036
    const g = bsGamma(100, 100, 20, 0.25, 0.065)
    expect(g).not.toBeNull()
    expect(g!).toBeCloseTo(0.0390036, 5)
  })

  it('equals pdf(d1) / (S·σ·√T) exactly', () => {
    const S = 25000
    const K = 25100
    const iv = 12.5
    const T = 7 / 365.25
    const r = 0.065
    const sigma = iv / 100
    const d1 = (Math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T))
    const expected = normPdf(d1) / (S * sigma * Math.sqrt(T))
    expect(bsGamma(S, K, iv, T, r)).toBeCloseTo(expected, 12)
  })

  it('guards invalid inputs with null', () => {
    expect(bsGamma(100, 100, 20, 0)).toBeNull() // expired
    expect(bsGamma(100, 100, 20, -0.1)).toBeNull() // past expiry
    expect(bsGamma(100, 100, null, 0.25)).toBeNull() // missing IV
    expect(bsGamma(100, 100, 0, 0.25)).toBeNull() // zero IV
    expect(bsGamma(0, 100, 20, 0.25)).toBeNull() // no spot
    expect(bsGamma(100, 0, 20, 0.25)).toBeNull() // no strike
  })
})

describe('computeStrikeGEX', () => {
  const spot = 25000
  const lot = 75
  const T = 7 / 365.25

  const rows: GexStrikeInput[] = [
    { strike: 24900, call: leg(1000, 12), put: leg(2000, 13) },
    { strike: 25000, call: leg(3000, 11), put: leg(3000, 11) },
    { strike: 25100, call: leg(4000, 12), put: leg(500, 14) },
  ]

  it('applies the dealer sign convention: calls positive, puts negative', () => {
    const out = computeStrikeGEX(rows, spot, lot, T)
    for (const r of out) {
      expect(r.callGEX).toBeGreaterThanOrEqual(0)
      expect(r.putGEX).toBeLessThanOrEqual(0)
      expect(r.netGEX).toBeCloseTo(r.callGEX + r.putGEX, 6)
      expect(r.absGEX).toBeCloseTo(Math.abs(r.callGEX) + Math.abs(r.putGEX), 6)
    }
  })

  it('skips a leg with missing IV while the other leg still counts', () => {
    const out = computeStrikeGEX(
      [{ strike: 25000, call: leg(3000, null), put: leg(3000, 11) }],
      spot,
      lot,
      T,
    )
    expect(out[0].callGEX).toBe(0)
    expect(out[0].putGEX).toBeLessThan(0)
    expect(out[0].netGEX).toBe(out[0].putGEX)
  })

  it('scales linearly with lot size and quadratically with spot', () => {
    const one = computeStrikeGEX(rows, spot, 1, T)
    const seventyFive = computeStrikeGEX(rows, spot, 75, T)
    expect(seventyFive[0].callGEX).toBeCloseTo(one[0].callGEX * 75, 6)

    // gamma itself carries a 1/S term, so GEX = pdf(d1)·S/(σ√T)·OI·lot
    // scales with S · pdf(d1(S)) — verify the spot² factor directly instead.
    const base = computeStrikeGEX(
      [{ strike: 25000, call: leg(1, 12), put: leg(0, 12) }],
      spot,
      1,
      T,
    )[0].callGEX
    const gamma = bsGamma(spot, 25000, 12, T)!
    expect(base).toBeCloseTo(gamma * 1 * 1 * spot * spot * 0.01, 6)
  })

  it('returns rows sorted by strike ascending', () => {
    const out = computeStrikeGEX([...rows].reverse(), spot, lot, T)
    expect(out.map((r) => r.strike)).toEqual([24900, 25000, 25100])
  })
})

describe('computeWalls', () => {
  it('picks max call-side GEX for Call Wall and max |put-side GEX| for Put Wall', () => {
    const rows = [
      row(24800, 100, -400), // net -300 (most negative)
      row(24900, 300, -100), // net +200
      row(25000, 900, -200), // net +700 (max positive)
      row(25100, 50, -150), // net -100
    ]
    expect(computeWalls(rows)).toEqual({ callWall: 25000, putWall: 24800 })
  })

  it('returns null walls when no strike qualifies', () => {
    expect(computeWalls([])).toEqual({ callWall: null, putWall: null })
    // all positive → no put wall
    expect(computeWalls([row(25000, 100, 0), row(25100, 200, 0)])).toEqual({
      callWall: 25100,
      putWall: null,
    })
    // all negative → no call wall
    expect(computeWalls([row(25000, 0, -100), row(25100, 0, -200)])).toEqual({
      callWall: null,
      putWall: 25100,
    })
  })
})

describe('computeNetGexCross', () => {
  it('interpolates the per-strike net GEX zero-cross between adjacent strikes', () => {
    // net: -100 @25000 → +300 @25100 ⇒ crosses zero 25% of the way
    const rows = [row(25000, 0, -100), row(25100, 400, -100)]
    expect(computeNetGexCross(rows)).toBeCloseTo(25025, 6)
  })

  it('returns the strike itself when net GEX is exactly zero there', () => {
    const rows = [row(25000, 100, -100), row(25100, 50, 0)]
    expect(computeNetGexCross(rows)).toBe(25000)
  })

  it('returns null when the net profile never changes sign', () => {
    expect(computeNetGexCross([row(25000, 100, 0), row(25100, 200, 0)])).toBeNull()
    expect(computeNetGexCross([])).toBeNull()
  })

  it('picks the crossing nearest spot when several exist', () => {
    // sign flips at 24950 (near) and 25150 (far); spot 24960 ⇒ 24950
    const rows = [
      row(24900, 0, -100),
      row(25000, 100, 0), // − → +  cross ~24950
      row(25100, 100, 0),
      row(25200, 0, -100), // + → −  cross ~25150
    ]
    expect(computeNetGexCross(rows, 24960)).toBeCloseTo(24950, 6)
  })

  it('is order-independent (sorts by strike internally)', () => {
    const rows = [row(25100, 400, -100), row(25000, 0, -100)]
    expect(computeNetGexCross(rows)).toBeCloseTo(25025, 6)
  })
})

describe('computeZeroGamma', () => {
  const lot = 75
  const T = 7 / 365.25

  it('finds the spot where total dealer net GEX crosses zero', () => {
    // Puts stacked low, calls stacked high ⇒ short gamma below, long gamma above.
    const rows: GexStrikeInput[] = [
      { strike: 24000, call: leg(100, 12), put: leg(6000, 12) },
      { strike: 24500, call: leg(6000, 12), put: leg(100, 12) },
    ]
    const flip = computeZeroGamma(rows, lot, T)
    expect(flip).not.toBeNull()
    expect(flip!).toBeGreaterThan(24000)
    expect(flip!).toBeLessThan(24500)
    // At the flip spot the recomputed total net GEX must be ≈ 0.
    const { netGEX } = aggregate(computeStrikeGEX(rows, flip!, lot, T))
    expect(toCrore(netGEX)).toBeCloseTo(0, 2)
  })

  it('returns null when total net GEX never changes sign across the range', () => {
    const rows: GexStrikeInput[] = [
      { strike: 24000, call: leg(0, 12), put: leg(5000, 12) },
      { strike: 24500, call: leg(0, 12), put: leg(5000, 12) },
    ]
    expect(computeZeroGamma(rows, lot, T)).toBeNull()
  })

  it('returns null for expired / single-strike inputs', () => {
    const rows: GexStrikeInput[] = [
      { strike: 24000, call: leg(100, 12), put: leg(100, 12) },
      { strike: 24500, call: leg(100, 12), put: leg(100, 12) },
    ]
    expect(computeZeroGamma(rows, lot, 0)).toBeNull() // expired
    expect(computeZeroGamma([rows[0]], lot, T)).toBeNull() // single strike
  })
})

describe('aggregate / regime / scaling', () => {
  it('totals net and abs GEX across strikes', () => {
    const rows = [row(25000, 100, -40), row(25100, 20, -300)]
    const { netGEX, absGEX } = aggregate(rows)
    expect(netGEX).toBeCloseTo(-220, 9)
    expect(absGEX).toBeCloseTo(460, 9)
  })

  it('labels the regime by the sign of net GEX', () => {
    expect(gexRegime(1)).toBe('long-gamma')
    expect(gexRegime(-1)).toBe('short-gamma')
  })

  it('converts rupees to Crore', () => {
    expect(toCrore(1e7)).toBe(1)
    expect(toCrore(-2.5e7)).toBe(-2.5)
  })
})

describe('yearsToExpiry', () => {
  it('divides calendar hours by 8766', () => {
    const t = yearsToExpiry('2026-07-10T10:00:00+00:00', '2026-07-14T10:00:00+00:00')
    expect(t).toBeCloseTo((4 * 24) / 8766, 12)
  })

  it('clamps past-expiry to zero and rejects bad input', () => {
    expect(yearsToExpiry('2026-07-15T10:00:00+00:00', '2026-07-14T10:00:00+00:00')).toBe(0)
    expect(yearsToExpiry('not-a-date', '2026-07-14T10:00:00+00:00')).toBe(0)
  })
})
