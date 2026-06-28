import type { BiasValue } from '../../api/endpoints'
import type { FactorModule } from './allInOne.types'
import {
  TrendingUp,
  BrickWall,
  Layers,
  Scale,
  Target,
  Magnet,
  Waves,
  BarChart3,
  Sigma,
  Flame,
  Shield,
  Signal,
  Activity,
  MoveVertical,
  MoveHorizontal,
  Droplet,
  Calendar,
  SlidersHorizontal,
  Coins,
  Compass,
} from 'lucide-react'
import {
  formatInt,
  formatNumber,
  formatPct,
  formatSignedPct,
  formatCompact,
  biasLabel,
  toPercent,
} from '../../lib/format'

/**
 * The 20 analytical factors, in display order.
 *
 * The 14 active factors read live data from the shared `ctx` (AllInOneContext),
 * which `useAllInOne` fills from the existing per-domain endpoints. Each declares
 * the `sources` it needs so the card can show a per-feed loading/error state.
 *
 * The 6 factors flagged `blocked: true` (Greeks, GEX, Volume Profile, VWAP, ATR,
 * Event Risk) have no backend feed yet — they stay static "Soon" placeholders
 * and declare no sources (they never fetch).
 */

// --- small local helpers -----------------------------------------------------

/** Spot price from a snapshot, tolerating the several field aliases. */
function spotOf(ctx: { snapshot?: { ltp?: number; last_price?: number; price?: number } }) {
  const s = ctx.snapshot
  return s?.ltp ?? s?.last_price ?? s?.price
}

/** Normalise a backend enum token (e.g. "CALL_WRITERS_DOMINANT") to words. */
function humanizeToken(token?: string): string | undefined {
  if (!token) return undefined
  const words = token.replace(/[_\-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Map a writing-posture / OI-buildup phrase to a directional bias. */
function postureBias(posture?: string): BiasValue {
  // Normalise "CALL_WRITERS_DOMINANT" → "call writers dominant" before matching.
  const p = (posture ?? '').replace(/[_\-]+/g, ' ').toLowerCase()
  if (p.includes('put writ') || p.includes('short cover') || p.includes('call unwind')) return 1
  if (p.includes('call writ') || p.includes('long unwind') || p.includes('put unwind')) return -1
  return 0
}

export const FACTOR_MODULES: FactorModule[] = [
  {
    index: 1,
    id: 'price-action',
    title: 'Price action',
    icon: TrendingUp,
    sources: ['snapshot'],
    compute: (ctx) => {
      const s = ctx.snapshot ?? {}
      const ltp = spotOf(ctx)
      const prev = s.prev_close
      const chgPct =
        s.change_pct ?? (ltp != null && prev ? ((ltp - prev) / prev) * 100 : undefined)
      const dir = (s.direction ?? '').toUpperCase()
      const pivot = ctx.levels?.pivot
      let bias: BiasValue = 0
      if (dir === 'UP' || (chgPct ?? 0) > 0.05) bias = 1
      else if (dir === 'DOWN' || (chgPct ?? 0) < -0.05) bias = -1
      const vsPivot =
        pivot != null && ltp != null ? (ltp >= pivot ? 'Above pivot' : 'Below pivot') : 'Intraday trend'
      return {
        value: `${biasLabel(bias)} · ${formatSignedPct(chgPct)}`,
        detail: vsPivot,
        bias,
        reasoning: [
          `Spot ${formatInt(ltp)} vs previous close ${formatInt(prev)} (${formatSignedPct(chgPct)}).`,
          pivot != null
            ? `Trading ${ltp != null && ltp >= pivot ? 'above' : 'below'} the day pivot ${formatInt(pivot)}.`
            : 'Direction from the live index snapshot.',
        ],
      }
    },
  },
  {
    index: 2,
    id: 'support-resistance',
    title: 'Support / resistance',
    icon: BrickWall,
    sources: ['levels'],
    compute: (ctx) => {
      const r = ctx.levels?.resistance?.[0] ?? ctx.snapshot?.resistance ?? ctx.optionsMetrics?.resistance
      const sup = ctx.levels?.support?.[0] ?? ctx.snapshot?.support ?? ctx.optionsMetrics?.support
      const ltp = spotOf(ctx)
      let bias: BiasValue = 0
      if (r != null && sup != null && ltp != null) {
        const mid = (r + sup) / 2
        if (ltp > mid + (r - sup) * 0.15) bias = 1
        else if (ltp < mid - (r - sup) * 0.15) bias = -1
      }
      return {
        value: `R ${formatInt(r)} · S ${formatInt(sup)}`,
        detail: bias > 0 ? 'Upper half of range' : bias < 0 ? 'Lower half of range' : 'Mid-range',
        bias,
        reasoning: [
          `Nearest resistance ${formatInt(r)}, nearest support ${formatInt(sup)}.`,
          ltp != null ? `Spot ${formatInt(ltp)} positioned within the band.` : 'Live pivot-derived levels.',
        ],
      }
    },
  },
  {
    index: 3,
    id: 'open-interest',
    title: 'Open interest',
    icon: Layers,
    sources: ['optionsMetrics'],
    compute: (ctx) => {
      const posture = ctx.optionsMetrics?.writing_posture
      const postureLabel = humanizeToken(posture)
      const bias = postureBias(posture)
      const callOi = ctx.optionsMetrics?.total_call_oi
      const putOi = ctx.optionsMetrics?.total_put_oi
      return {
        value: postureLabel ?? '—',
        detail:
          callOi != null && putOi != null
            ? `Calls ${formatCompact(callOi)} · Puts ${formatCompact(putOi)}`
            : 'OI writing posture',
        bias,
        reasoning: [
          postureLabel ? `Writing posture: ${postureLabel}.` : 'Aggregate OI posture from the option chain.',
          callOi != null && putOi != null
            ? `Total call OI ${formatCompact(callOi)} vs put OI ${formatCompact(putOi)}.`
            : 'Total OI split pending.',
        ],
      }
    },
  },
  {
    index: 4,
    id: 'pcr',
    title: 'PCR',
    icon: Scale,
    sources: ['optionsMetrics'],
    compute: (ctx) => {
      const pcr = ctx.optionsMetrics?.pcr_oi
      let bias: BiasValue = 0
      if (pcr != null) bias = pcr >= 1.1 ? 1 : pcr <= 0.9 ? -1 : 0
      return {
        value: formatNumber(pcr, 2),
        detail: bias > 0 ? 'Put-heavy · supportive' : bias < 0 ? 'Call-heavy · capped' : 'Balanced',
        bias,
        reasoning: [
          pcr != null
            ? `PCR (OI) ${formatNumber(pcr, 2)} — ${bias > 0 ? 'more puts written, supportive bias' : bias < 0 ? 'more calls written, overhead supply' : 'roughly balanced writing'}.`
            : 'Put/Call OI ratio from the live chain.',
        ],
      }
    },
  },
  {
    index: 5,
    id: 'max-pain',
    title: 'Max pain',
    icon: Target,
    sources: ['optionsMetrics'],
    compute: (ctx) => {
      const maxPain = ctx.optionsMetrics?.max_pain
      const ltp = spotOf(ctx)
      const delta = maxPain != null && ltp != null ? maxPain - ltp : undefined
      return {
        value: formatInt(maxPain),
        detail:
          delta != null
            ? `${formatInt(Math.abs(delta))} pts ${delta < 0 ? 'below' : delta > 0 ? 'above' : 'at'} spot`
            : 'Expiry magnet',
        bias: 0,
        reasoning: [
          maxPain != null
            ? `Max pain at ${formatInt(maxPain)} — gravitational pull into expiry${delta != null ? ` (${formatInt(Math.abs(delta))} pts ${delta < 0 ? 'below' : 'above'} spot)` : ''}.`
            : 'Max pain strike from the option chain.',
        ],
      }
    },
  },
  {
    index: 6,
    id: 'magnet-zones',
    title: 'Magnet zones',
    icon: Magnet,
    sources: ['chain'],
    compute: (ctx) => {
      const chain = ctx.chain ?? []
      const top = (type: 'CE' | 'PE') =>
        chain
          .filter((r) => r.type === type && r.oi != null)
          .sort((a, b) => (b.oi ?? 0) - (a.oi ?? 0))[0]
      const topPut = top('PE')
      const topCall = top('CE')
      return {
        value: `${formatInt(topPut?.strike)} / ${formatInt(topCall?.strike)}`,
        detail: 'Heavy OI walls',
        bias: 0,
        reasoning: [
          topPut != null
            ? `Largest put OI wall (floor) at ${formatInt(topPut.strike)}.`
            : 'Put OI wall from the chain.',
          topCall != null
            ? `Largest call OI wall (ceiling) at ${formatInt(topCall.strike)}.`
            : 'Call OI wall from the chain.',
        ],
      }
    },
  },
  {
    index: 7,
    id: 'iv',
    title: 'Implied vol',
    icon: Waves,
    sources: ['optionsMetrics'],
    compute: (ctx) => {
      const iv = ctx.optionsMetrics?.atm_iv
      const detail =
        iv == null ? 'ATM implied vol' : iv < 12 ? 'Low' : iv < 18 ? 'Low-to-medium' : 'Elevated'
      return {
        value: formatPct(iv, 1),
        detail,
        bias: 0,
        reasoning: [
          iv != null
            ? `ATM IV ${formatPct(iv, 1)} — ${detail.toLowerCase()} premium regime.`
            : 'ATM implied volatility from the chain.',
        ],
      }
    },
  },
  {
    index: 8,
    id: 'iv-rank',
    title: 'IV rank',
    icon: BarChart3,
    sources: ['optionsMetrics'],
    compute: (ctx) => {
      const ivp = ctx.optionsMetrics?.iv_percentile
      const label = ctx.optionsMetrics?.iv_percentile_label
      return {
        value: ivp != null ? `IVR ${formatInt(ivp)}` : label ?? '—',
        detail: label ?? (ivp != null ? (ivp < 35 ? 'Premiums on cheap side' : ivp > 65 ? 'Premiums rich' : 'Mid-range') : 'IV percentile'),
        bias: 0,
        reasoning: [
          ivp != null
            ? `IV percentile ${formatInt(ivp)} — ${ivp < 35 ? 'IV cheap vs its own history' : ivp > 65 ? 'IV expensive vs history' : 'mid-range vs history'}.`
            : 'IV percentile from the options metrics feed.',
        ],
      }
    },
  },
  {
    index: 9,
    id: 'greeks',
    title: 'Greeks',
    icon: Sigma,
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
    icon: Flame,
    sources: ['snapshot'],
    compute: (ctx) => {
      const vix = ctx.snapshot?.india_vix
      const detail =
        vix == null ? 'Volatility index' : vix < 13 ? 'Low fear / complacent' : vix < 20 ? 'Moderate' : 'Elevated fear'
      return {
        value: formatNumber(vix, 2),
        detail,
        bias: 0,
        reasoning: [
          vix != null
            ? `India VIX ${formatNumber(vix, 2)} — ${detail.toLowerCase()}.`
            : 'India VIX from the live index snapshot.',
        ],
      }
    },
  },
  {
    index: 11,
    id: 'gex',
    title: 'GEX',
    icon: Shield,
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
    icon: Signal,
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
    icon: Activity,
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
    icon: MoveVertical,
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
    icon: MoveHorizontal,
    sources: ['chain', 'optionsMetrics'],
    compute: (ctx) => {
      const atm = ctx.optionsMetrics?.atm_strike ?? ctx.snapshot?.atm_strike
      const ce = ctx.chain?.find((r) => r.type === 'CE' && r.strike === atm)?.ltp
      const pe = ctx.chain?.find((r) => r.type === 'PE' && r.strike === atm)?.ltp
      const move = ce != null && pe != null ? ce + pe : undefined
      return {
        value: move != null ? `±${formatInt(move)} pts` : '—',
        detail: 'ATM straddle implied',
        bias: 0,
        reasoning: [
          move != null
            ? `ATM (${formatInt(atm)}) straddle premium ${formatInt(move)} ≈ the market-implied 1-day move.`
            : 'Derived from the ATM straddle premium on the live chain.',
        ],
      }
    },
  },
  {
    index: 16,
    id: 'liquidity',
    title: 'Liquidity',
    icon: Droplet,
    sources: ['chain'],
    compute: (ctx) => {
      const chain = ctx.chain ?? []
      const totalVol = chain.reduce((sum, r) => sum + (r.volume ?? 0), 0)
      const bias: BiasValue = totalVol > 0 ? 1 : 0
      return {
        value: totalVol > 0 ? `${formatCompact(totalVol)} vol` : '—',
        detail: 'Bid-ask spread pending',
        bias,
        reasoning: [
          totalVol > 0
            ? `Aggregate chain volume ${formatCompact(totalVol)} contracts — actively traded.`
            : 'Chain volume from the live feed.',
          'Bid-ask spread enrichment pending a depth feed (partial — P2).',
        ],
      }
    },
  },
  {
    index: 17,
    id: 'event-risk',
    title: 'Event risk',
    icon: Calendar,
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
    icon: SlidersHorizontal,
    sources: ['signal'],
    compute: (ctx) => {
      const rr = ctx.signal?.risk_reward
      const rrNum = typeof rr === 'number' ? rr : typeof rr === 'string' ? Number(rr) : NaN
      const value = Number.isFinite(rrNum) ? `1 : ${formatNumber(rrNum, 1)}` : typeof rr === 'string' ? rr : '—'
      const detail = Number.isFinite(rrNum)
        ? rrNum >= 2
          ? 'Premium quality'
          : rrNum >= 1.5
            ? 'Acceptable quality'
            : 'Thin reward'
        : 'On the latest signal'
      return {
        value,
        detail,
        bias: 0,
        reasoning: [
          Number.isFinite(rrNum)
            ? `Reward ${formatNumber(rrNum, 1)}× risk on the latest signal setup.`
            : 'Risk/reward from the latest signal.',
        ],
      }
    },
  },
  {
    index: 19,
    id: 'position-sizing',
    title: 'Position size',
    icon: Coins,
    sources: ['signal'],
    compute: (ctx) => {
      const entry = Number(ctx.signal?.entry_ref)
      const stop = Number(ctx.signal?.stop_ref)
      const riskPts =
        Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) : undefined
      return {
        value: riskPts != null ? `2% · ${formatInt(riskPts)} pt SL` : '2% capital',
        detail: 'Conservative alloc',
        bias: 0,
        reasoning: [
          riskPts != null
            ? `Risk capped at 2% of capital with a ${formatInt(riskPts)} pt stop from the signal — size lots to that.`
            : 'Risk fixed at 2% of capital; lot count depends on your capital base.',
        ],
      }
    },
  },
  {
    index: 20,
    id: 'trading-decision',
    title: 'Trading decision',
    icon: Compass,
    sources: ['signal'],
    compute: (ctx) => {
      const sig = ctx.signal
      const biasRaw = sig?.bias
      const bias: BiasValue = biasRaw === 1 || biasRaw === -1 ? biasRaw : 0
      const label = sig?.label ?? sig?.bias_label ?? biasLabel(bias)
      // confidence may arrive 0–1 or 0–100 — normalise to a percent.
      const conf = sig?.confidence != null ? toPercent(sig.confidence) : undefined
      return {
        value: label,
        detail: conf != null ? `Confidence ${conf}%` : 'Net signal read',
        bias,
        reasoning: [
          `Net read across factors → ${label}${conf != null ? ` at ${conf}% confidence` : ''}.`,
          sig?.reasoning ?? 'Synthesised from the latest signal.',
        ],
      }
    },
  },
]
