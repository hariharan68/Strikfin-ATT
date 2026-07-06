"""
api/v1/routers/smart_money.py
------------------------------
GET /api/v1/smart-money/{instrument_id}
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Path

from app.core.deps import CurrentUserId
from app.engines.options_math import ChainRow, classify_buildup, oi_walls
from app.ingestion.providers import get_option_chain, get_spot

router = APIRouter(prefix="/smart-money", tags=["smart-money"])

# ─────────────────────────────────────────────────────────────
# SIGNAL TYPE LABELS
# ─────────────────────────────────────────────────────────────

_SIGNAL_LABELS = {
    1: "Long Build-up",
    2: "Short Build-up",
    3: "Long Unwinding",
    4: "Short Covering",
    5: "Unusual OI",
    6: "Unusual Volume",
}


@router.get("/{instrument_id}")
async def smart_money(
    instrument_id: int = Path(..., ge=1),
    _uid: CurrentUserId = None,
):
    """
    Smart-money signal detection.

    Methodology:
        Per-strike build-up classification (price × OI direction matrix)
        Unusual OI flag — when |oi_change| > 10% of total OI at strike
        Unusual Volume flag — when volume > 15% of total OI at strike
        Signals ranked by strength (|oi_change| / oi)
        Top 10 signals returned

    Aggregate bias:
        Bull score = sum of strength for LONG_BUILDUP + SHORT_COVERING
        Bear score = sum of strength for SHORT_BUILDUP + LONG_UNWINDING
        Bias = BULLISH if bull > bear × 1.2 else BEARISH or NEUTRAL

    Returns:
        aggregate_bias        — 1 Bullish | 0 Neutral | -1 Bearish
        aggregate_bias_label  — plain label
        aggregate_confidence  — 0 to 1
        top_signals           — list of top 10 ranked signals
        total_signals_found   — how many strikes had meaningful activity
    """

    # ── Fetch data ────────────────────────────────────────────
    spot_data  = get_spot(instrument_id)
    spot       = spot_data["last_price"]
    change_pct = spot_data.get("change_pct", 0.0) or 0.0

    chain_data = get_option_chain(instrument_id)
    raw_rows   = chain_data["rows"]

    # ── Classify each strike ──────────────────────────────────
    signals = []

    for r in raw_rows:
        oi        = r.get("oi", 0) or 0
        oi_chg    = r.get("oi_change", 0) or 0
        volume    = r.get("volume", 0) or 0

        # Skip illiquid strikes
        if oi < 10_000:
            continue

        code, label = classify_buildup(change_pct, oi_chg)

        # Strength = how significant is this OI move
        strength   = min(abs(oi_chg) / max(oi, 1), 1.0)
        confidence = round(min(0.40 + strength * 0.55, 0.92), 4)

        # Override to unusual flags if thresholds crossed
        signal_type = code
        if abs(oi_chg) > oi * 0.10:
            signal_type = 5   # UNUSUAL_OI
        elif volume > oi * 0.15:
            signal_type = 6   # UNUSUAL_VOLUME

        # Only include meaningful moves
        if strength < 0.02:
            continue

        signals.append({
            "strike":        r["strike"],
            "option_type":   r["option_type"],
            "signal_type":   signal_type,
            "signal_label":  _SIGNAL_LABELS.get(signal_type, label),
            "oi":            oi,
            "oi_change":     oi_chg,
            "volume":        volume,
            "strength":      round(strength, 4),
            "confidence":    confidence,
        })

    # ── Rank by strength ──────────────────────────────────────
    signals.sort(key=lambda x: x["strength"], reverse=True)
    top_signals = signals[:10]

    # ── Aggregate bias ────────────────────────────────────────
    bull_score = sum(
        s["strength"] for s in top_signals
        if s["signal_type"] in (1, 4)   # LONG_BUILDUP + SHORT_COVERING
    )
    bear_score = sum(
        s["strength"] for s in top_signals
        if s["signal_type"] in (2, 3)   # SHORT_BUILDUP + LONG_UNWINDING
    )

    total = bull_score + bear_score

    if bull_score > bear_score * 1.2:
        agg_bias       = 1
        agg_bias_label = "Bullish"
    elif bear_score > bull_score * 1.2:
        agg_bias       = -1
        agg_bias_label = "Bearish"
    else:
        agg_bias       = 0
        agg_bias_label = "Neutral"

    agg_confidence = round(
        max(bull_score, bear_score) / total
        if total > 0 else 0.5,
        4,
    )

    return {
        "instrument_id":         instrument_id,
        "as_of":                 datetime.now(timezone.utc).isoformat(),
        "spot":                  spot,
        "aggregate_bias":        agg_bias,
        "aggregate_bias_label":  agg_bias_label,
        "aggregate_confidence":  agg_confidence,
        "top_signals":           top_signals,
        "total_signals_found":   len(signals),
        "summary": (
            f"{len(top_signals)} smart-money signals detected. "
            f"Aggregate bias: {agg_bias_label} "
            f"({agg_confidence:.0%} confidence)."
        ),
    }