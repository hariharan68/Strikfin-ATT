import { describe, expect, it } from 'vitest'

import {
  computePainCurve,
  maxPainStrike,
  maxPainSentiment,
  type PainPoint,
} from '../maxpain'

describe('computePainCurve', () => {
  const strikes = [100, 110, 120]
  // Calls concentrated low (strike 100), puts concentrated high (strike 120).
  const callOi = [300, 0, 0]
  const putOi = [0, 0, 300]

  it('returns one point per strike, sorted ascending, aligned', () => {
    const curve = computePainCurve([120, 100, 110], [1, 2, 3], [4, 5, 6])
    expect(curve.map((p) => p.strike)).toEqual([100, 110, 120])
  })

  it('call pain accrues from strikes BELOW E; put pain from strikes ABOVE E', () => {
    const curve = computePainCurve(strikes, callOi, putOi)
    const byK = new Map(curve.map((p) => [p.strike, p]))

    // At E=100: no strike below → callPain 0; put@120 (300) is above → 300·20 = 6000.
    expect(byK.get(100)!.callPain).toBe(0)
    expect(byK.get(100)!.putPain).toBe(300 * 20)
    // At E=120: call@100 (300) below → 300·20 = 6000; no strike above → putPain 0.
    expect(byK.get(120)!.callPain).toBe(300 * 20)
    expect(byK.get(120)!.putPain).toBe(0)
    // totalPain = call + put at every point.
    for (const p of curve) expect(p.totalPain).toBe(p.callPain + p.putPain)
  })

  it('treats null OI as zero', () => {
    const curve = computePainCurve([100, 110], [null, 10], [10, null])
    // E=100: put@110 (null→0) above → putPain 0; nothing below → callPain 0.
    expect(curve[0].totalPain).toBe(0)
  })
})

describe('maxPainStrike', () => {
  it('picks the argmin of total pain (the classic V minimum)', () => {
    // Symmetric OI around 110 ⇒ minimum total pain at the middle strike.
    const strikes = [100, 110, 120]
    const curve = computePainCurve(strikes, [100, 100, 100], [100, 100, 100])
    expect(maxPainStrike(curve)).toBe(110)
  })

  it('returns null for an empty curve', () => {
    expect(maxPainStrike([])).toBeNull()
  })

  it('resolves ties to the first (lowest) minimum strike', () => {
    const curve: PainPoint[] = [
      { strike: 100, callPain: 0, putPain: 5, totalPain: 5 },
      { strike: 110, callPain: 0, putPain: 5, totalPain: 5 },
    ]
    expect(maxPainStrike(curve)).toBe(100)
  })
})

describe('maxPainSentiment', () => {
  it('is bullish when spot is above the pin', () => {
    const s = maxPainSentiment(24320, 24250)
    expect(s.regime).toBe('bullish')
    expect(s.bullishPct).toBeGreaterThan(50)
  })

  it('is bearish when spot is below the pin', () => {
    const s = maxPainSentiment(24180, 24250)
    expect(s.regime).toBe('bearish')
    expect(s.bullishPct).toBeLessThan(50)
  })

  it('is neutral when spot is pinned at max pain', () => {
    const s = maxPainSentiment(24250, 24250)
    expect(s.regime).toBe('neutral')
    expect(s.bullishPct).toBe(50)
  })

  it('clamps bullishPct to 0..100 and guards bad input', () => {
    expect(maxPainSentiment(30000, 24250).bullishPct).toBe(100)
    expect(maxPainSentiment(18000, 24250).bullishPct).toBe(0)
    expect(maxPainSentiment(24250, 0).regime).toBe('neutral')
  })
})
