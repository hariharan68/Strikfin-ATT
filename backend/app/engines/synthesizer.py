"""
engines/synthesizer.py
----------------------
AI Signal Synthesizer.
Fuses all intelligence modules into a single bias output.
Pure function — no DB, no network, no FastAPI.

COMPLIANCE NOTE:
    Outputs are always disclosure_mode = "intelligence"
    Entry/Stop/Target are illustrative risk framework values only.
    NOT investment advice. NOT a buy/sell recommendation.
"""
from dataclasses import dataclass
from typing import Optional


# ─────────────────────────────────────────────────────────────
# INPUT / OUTPUT
# ─────────────────────────────────────────────────────────────

@dataclass
class SignalInputs:
    # Options
    pcr_oi:                  float
    writing_posture:         str    # CALL_WRITERS_DOMINANT | PUT_WRITERS_DOMINANT | BALANCED
    oi_buildup:              str    # LONG_BUILDUP | SHORT_BUILDUP | SHORT_COVERING | LONG_UNWINDING
    spot:                    float
    support:                 Optional[float]
    resistance:              Optional[float]
    max_pain:                Optional[float]
    atr_20:                  Optional[float]  # 20-period ATR for stop/target

    # Smart Money
    smart_money_bias:        int    # 1 | 0 | -1
    smart_money_confidence:  float  # 0–1

    # Institutional
    fii_net_cr:              Optional[float]
    fii_fut_bias:            str    # LONG | SHORT | NEUTRAL

    # Sentiment
    sentiment_score:         float  # -1 to 1
    sentiment_confidence:    float  # 0–1


@dataclass
class SynthesizedSignal:
    bias:         int            # 1 Bullish | 0 Neutral | -1 Bearish
    entry_ref:    Optional[float]
    stop_ref:     Optional[float]
    target_ref:   Optional[float]
    risk_reward:  Optional[float]
    confidence:   float
    reasoning:    str
    evidence:     dict


# ─────────────────────────────────────────────────────────────
# SYNTHESIZER
# ─────────────────────────────────────────────────────────────

def synthesize(inp: SignalInputs) -> SynthesizedSignal:
    """
    Weighted vote across all intelligence modules.

    Weights:
        OI / Options 2.5
        Smart Money  2.0
        FII          1.5
        Sentiment    1.0
        Total        7.0

    bias_score > 0  → Bullish
    bias_score < 0  → Bearish
    near zero       → Neutral (threshold ±0.15 normalised)
    """
    bias_score   = 0.0
    weight_used  = 0.0
    evidence: dict[str, str] = {}

    # ── OI Build-up (2.5) ─────────────────────────────────────
    w = 2.5
    buildup = inp.oi_buildup

    if buildup == "LONG_BUILDUP":
        bias_score += w
        evidence["oi_buildup"] = "Long build-up — fresh longs entering"
    elif buildup == "SHORT_BUILDUP":
        bias_score -= w
        evidence["oi_buildup"] = "Short build-up — fresh shorts entering"
    elif buildup == "SHORT_COVERING":
        bias_score += w * 0.6
        evidence["oi_buildup"] = "Short covering — shorts exiting (possible exhaustion)"
    elif buildup == "LONG_UNWINDING":
        bias_score -= w * 0.6
        evidence["oi_buildup"] = "Long unwinding — longs exiting"

    # Writing posture addon
    if inp.writing_posture == "PUT_WRITERS_DOMINANT":
        bias_score += 0.8
        evidence["writing"] = "Put writers dominant → floor defense"
    elif inp.writing_posture == "CALL_WRITERS_DOMINANT":
        bias_score -= 0.8
        evidence["writing"] = "Call writers dominant → ceiling defense"

    weight_used += w

    # ── Smart Money (2.0) ─────────────────────────────────────
    w = 2.0
    bias_score += inp.smart_money_bias * w * inp.smart_money_confidence
    sm_label = {1: "bullish", 0: "neutral", -1: "bearish"}.get(
        inp.smart_money_bias, "neutral"
    )
    evidence["smart_money"] = (
        f"Smart money {sm_label} ({inp.smart_money_confidence:.0%} conf)"
    )
    weight_used += w

    # ── FII (1.5) ─────────────────────────────────────────────
    w = 1.5
    if inp.fii_net_cr is not None:
        if inp.fii_net_cr > 2000:
            bias_score += w * 0.5
            evidence["fii_cash"] = f"FII net buy ₹{inp.fii_net_cr:.0f} cr"
        elif inp.fii_net_cr < -2000:
            bias_score -= w * 0.5
            evidence["fii_cash"] = f"FII net sell ₹{abs(inp.fii_net_cr):.0f} cr"

    if inp.fii_fut_bias == "LONG":
        bias_score += w * 0.5
        evidence["fii_fut"] = "FII futures net long"
    elif inp.fii_fut_bias == "SHORT":
        bias_score -= w * 0.5
        evidence["fii_fut"] = "FII futures net short"

    weight_used += w

    # ── Sentiment (1.0) ───────────────────────────────────────
    w = 1.0
    bias_score += inp.sentiment_score * w * inp.sentiment_confidence
    evidence["sentiment"] = (
        f"Sentiment score {inp.sentiment_score:+.2f} "
        f"({inp.sentiment_confidence:.0%} conf)"
    )
    weight_used += w

    # ── Determine Bias ────────────────────────────────────────
    normalised = bias_score / weight_used if weight_used else 0.0

    if normalised > 0.15:
        bias = 1
        bias_label = "Bullish"
    elif normalised < -0.15:
        bias = -1
        bias_label = "Bearish"
    else:
        bias = 0
        bias_label = "Neutral"

    confidence = max(round(min(abs(normalised), 0.95), 4), 0.30)

    # ── Illustrative Risk Framework ───────────────────────────
    entry_ref:   Optional[float] = None
    stop_ref:    Optional[float] = None
    target_ref:  Optional[float] = None
    risk_reward: Optional[float] = None

    if inp.atr_20 and inp.atr_20 > 0:
        entry_ref = inp.spot

        if bias == 1:
            stop_ref = round(
                (inp.support - inp.atr_20 * 0.5)
                if inp.support else
                (inp.spot - inp.atr_20 * 1.5),
                2,
            )
            target_ref = round(
                inp.resistance
                if inp.resistance else
                (inp.spot + inp.atr_20 * 2.0),
                2,
            )

        elif bias == -1:
            stop_ref = round(
                (inp.resistance + inp.atr_20 * 0.5)
                if inp.resistance else
                (inp.spot + inp.atr_20 * 1.5),
                2,
            )
            target_ref = round(
                inp.support
                if inp.support else
                (inp.spot - inp.atr_20 * 2.0),
                2,
            )

        if entry_ref and stop_ref and target_ref:
            risk   = abs(entry_ref - stop_ref)
            reward = abs(target_ref - entry_ref)
            risk_reward = round(reward / risk, 2) if risk > 0 else None

    # ── Plain-English Reasoning ───────────────────────────────
    top_evidence = list(evidence.values())[:4]
    reasoning = (
        f"**{bias_label}** bias | confidence {confidence:.0%} | "
        + " · ".join(top_evidence)
    )

    return SynthesizedSignal(
        bias=bias,
        entry_ref=entry_ref,
        stop_ref=stop_ref,
        target_ref=target_ref,
        risk_reward=risk_reward,
        confidence=confidence,
        reasoning=reasoning,
        evidence=evidence,
    )


# ─────────────────────────────────────────────────────────────
# BIAS LABEL HELPER
# ─────────────────────────────────────────────────────────────

def bias_label(bias: int) -> str:
    return {1: "Bullish", 0: "Neutral", -1: "Bearish"}.get(bias, "Neutral")