"""
engines/regime.py
-----------------
7-state market regime classifier.
Pure rule-based logic — no ML, no DB, no IO.
Fully explainable and auditable.

States:
    1  TREND_UP    sustained upward move with strength
    2  TREND_DOWN  sustained downward move with strength
    3  SIDEWAYS    range-bound, low directional momentum
    4  BREAKOUT    price breaking out of compressed range
    5  REVERSAL    momentum turning, OI unwinding
    6  HIGH_VOL    elevated volatility — VIX spike or range expansion
    7  LOW_VOL     compressed volatility — calm, pre-event often
"""
from dataclasses import dataclass
from typing import Optional


# ─────────────────────────────────────────────────────────────
# FEATURE INPUT
# ─────────────────────────────────────────────────────────────

@dataclass
class RegimeFeatures:
    # Price
    return_1d:         float   # today's % return
    return_5d:         float   # 5-day % return
    trend_strength:    float   # ADX-style 0–100
    range_compression: float   # today range / 20d ATR  (<0.7 = compressed)

    # Volatility
    india_vix:         Optional[float]
    vix_percentile:    float   # 0–1 within 52-week range
    realized_vol_pct:  float   # today realized vol percentile

    # Options
    pcr_oi:            float
    oi_buildup:        str     # LONG_BUILDUP | SHORT_BUILDUP | SHORT_COVERING | LONG_UNWINDING
    writing_posture:   str     # CALL_WRITERS_DOMINANT | PUT_WRITERS_DOMINANT | BALANCED
    spot_vs_max_pain:  float   # (spot - max_pain) / spot

    # Institutional
    fii_cash_net_cr:   Optional[float]
    fii_fut_bias:      str     # LONG | SHORT | NEUTRAL


# ─────────────────────────────────────────────────────────────
# REGIME LABELS
# ─────────────────────────────────────────────────────────────

REGIME_LABELS = {
    1: "Trend Up",
    2: "Trend Down",
    3: "Sideways",
    4: "Breakout",
    5: "Reversal",
    6: "High Volatility",
    7: "Low Volatility",
}


def regime_label(code: int) -> str:
    return REGIME_LABELS.get(code, "Unknown")


# ─────────────────────────────────────────────────────────────
# CLASSIFIER
# ─────────────────────────────────────────────────────────────

def classify_regime(
    f: RegimeFeatures,
) -> tuple[int, float, dict]:
    """
    Weighted evidence vote across all input signals.
    Returns (regime_code, confidence_0_to_1, evidence_dict).

    Each signal adds score to one or more regime buckets.
    Winner = highest score. Confidence = winner / max_possible.
    """
    scores: dict[int, float] = {i: 0.0 for i in range(1, 8)}
    evidence: dict[str, str] = {}

    # ── Volatility signals (weight: 3.0) ──────────────────────
    if f.vix_percentile > 0.80:
        scores[6] += 3.0
        evidence["vix"] = (
            f"VIX at {f.vix_percentile:.0%} percentile → High Volatility"
        )
    elif f.vix_percentile < 0.20:
        scores[7] += 2.0
        evidence["vix"] = (
            f"VIX at {f.vix_percentile:.0%} percentile → Low Volatility"
        )

    if f.range_compression < 0.65:
        scores[7] += 1.5
        evidence["range"] = (
            f"Range compression {f.range_compression:.2f} → compressed"
        )
    elif f.range_compression > 1.5:
        scores[6] += 1.5
        evidence["range"] = (
            f"Range expansion {f.range_compression:.2f} → elevated vol"
        )

    # ── Trend signals (weight: 2.5) ───────────────────────────
    if f.trend_strength > 30:
        if f.return_1d > 0 and f.return_5d > 0:
            scores[1] += 2.5
            evidence["trend"] = (
                f"ADX {f.trend_strength:.0f} | "
                f"1d {f.return_1d:+.2f}% | "
                f"5d {f.return_5d:+.2f}% → Trend Up"
            )
        elif f.return_1d < 0 and f.return_5d < 0:
            scores[2] += 2.5
            evidence["trend"] = (
                f"ADX {f.trend_strength:.0f} | "
                f"1d {f.return_1d:+.2f}% | "
                f"5d {f.return_5d:+.2f}% → Trend Down"
            )
    elif f.trend_strength < 20:
        scores[3] += 1.5
        evidence["trend"] = (
            f"ADX {f.trend_strength:.0f} < 20 → Sideways"
        )

    # ── OI Build-up signals (weight: 2.0) ────────────────────
    buildup = f.oi_buildup
    if buildup == "LONG_BUILDUP":
        scores[1] += 2.0
        evidence["oi_buildup"] = "Long build-up → fresh longs corroborate Trend Up"
    elif buildup == "SHORT_BUILDUP":
        scores[2] += 2.0
        evidence["oi_buildup"] = "Short build-up → fresh shorts corroborate Trend Down"
    elif buildup == "LONG_UNWINDING":
        scores[5] += 1.0
        scores[2] += 0.5
        evidence["oi_buildup"] = "Long unwinding → possible Reversal forming"
    elif buildup == "SHORT_COVERING":
        scores[5] += 0.5
        scores[1] += 1.0
        evidence["oi_buildup"] = "Short covering → rally, watch for Reversal"

    # ── Writing posture (weight: 1.0) ─────────────────────────
    if f.writing_posture == "PUT_WRITERS_DOMINANT":
        scores[1] += 1.0
        evidence["writing"] = "Put writers dominant → floor defense → bullish"
    elif f.writing_posture == "CALL_WRITERS_DOMINANT":
        scores[2] += 1.0
        evidence["writing"] = "Call writers dominant → ceiling defense → bearish"

    # ── Breakout detection (weight: 2.5) ──────────────────────
    if (
        f.range_compression < 0.70
        and abs(f.return_1d) > 0.80
        and buildup in ("LONG_BUILDUP", "SHORT_BUILDUP")
    ):
        scores[4] += 2.5
        direction = "upside" if f.return_1d > 0 else "downside"
        evidence["breakout"] = (
            f"Compressed range broke {direction} with {buildup} → Breakout"
        )

    # ── FII signals (weight: 0.5) ─────────────────────────────
    if f.fii_cash_net_cr and f.fii_cash_net_cr > 2000:
        scores[1] += 0.5
        evidence["fii"] = (
            f"FII net buy ₹{f.fii_cash_net_cr:.0f} cr → bullish support"
        )
    elif f.fii_cash_net_cr and f.fii_cash_net_cr < -2000:
        scores[2] += 0.5
        evidence["fii"] = (
            f"FII net sell ₹{abs(f.fii_cash_net_cr):.0f} cr → bearish pressure"
        )

    if f.fii_fut_bias == "LONG":
        scores[1] += 0.5
        evidence["fii_fut"] = "FII futures net long → bullish"
    elif f.fii_fut_bias == "SHORT":
        scores[2] += 0.5
        evidence["fii_fut"] = "FII futures net short → bearish"

    # ── Determine winner ──────────────────────────────────────
    winner = max(scores, key=lambda k: scores[k])
    max_possible = 13.0   # sum of all max weights
    raw_conf = min(scores[winner] / max_possible, 1.0)
    confidence = max(round(raw_conf, 4), 0.35)  # floor at 35%

    return winner, confidence, evidence