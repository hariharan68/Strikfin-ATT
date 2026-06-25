"""
services/market_history.py
--------------------------
Derives REAL volatility/trend features from historical daily candles, so the
synthesizer and regime classifier stop running on fabricated constants.

Single source of truth for: ATR (stop/target sizing), ADX trend strength,
multi-day returns, range compression, and realized volatility. Everything is
computed from the provider's history feed (Fyers daily OHLC, mock in dev) and
falls back honestly — `from_real_data=False` and `atr=None` — when there isn't
enough history, so callers can choose a safe proxy rather than trust a guess.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from app.engines.options_math import atr as compute_atr
from app.engines.options_math import realized_vol, trend_strength
from app.ingestion.providers import get_history

logger = logging.getLogger(__name__)

# Need at least this many daily bars for a meaningful 20-period ATR/ADX.
_MIN_BARS = 21

# Realized-vol band (decimal) used to place current vol on a 0–1 scale.
_RVOL_LO = 0.05
_RVOL_HI = 0.30


@dataclass
class MarketFeatures:
    atr_20:            Optional[float]  # price points; None when no history
    adx:               float            # 0–100 trend strength
    return_1d:         float            # %
    return_5d:         float            # %
    range_compression: float            # latest bar range / ATR (1.0 = neutral)
    realized_vol_pct:  float            # 0–1 within typical band
    from_real_data:    bool             # False → caller should use a proxy


def _pct_change(new: float, old: float) -> float:
    return round((new - old) / old * 100.0, 3) if old else 0.0


def get_market_features(instrument_id: int) -> MarketFeatures:
    """
    Fetch daily history and derive volatility/trend features. Never raises —
    on any failure or thin history it returns a neutral, clearly-flagged
    fallback (`from_real_data=False`).
    """
    fallback = MarketFeatures(
        atr_20=None, adx=0.0, return_1d=0.0, return_5d=0.0,
        range_compression=1.0, realized_vol_pct=0.5, from_real_data=False,
    )
    try:
        hist = get_history(instrument_id, days=60, resolution="D")
        candles = hist.get("candles") or []
        # Mock-fallback history is not real market data — don't dress it up.
        if hist.get("source") == "mock_fallback" or len(candles) < _MIN_BARS:
            return fallback

        closes = [float(c["close"]) for c in candles if c.get("close")]
        if len(closes) < _MIN_BARS:
            return fallback

        atr_20 = compute_atr(candles, period=20)
        adx    = trend_strength(closes, period=14)
        ret_1d = _pct_change(closes[-1], closes[-2])
        ret_5d = _pct_change(closes[-1], closes[-6]) if len(closes) >= 6 else ret_1d

        last = candles[-1]
        last_range = float(last["high"]) - float(last["low"])
        range_compression = round(last_range / atr_20, 3) if atr_20 else 1.0

        rvol = realized_vol(candles, period=20)
        if rvol is None:
            rvol_pct = 0.5
        else:
            rvol_pct = max(0.0, min(1.0, (rvol - _RVOL_LO) / (_RVOL_HI - _RVOL_LO)))

        return MarketFeatures(
            atr_20=atr_20,
            adx=adx,
            return_1d=ret_1d,
            return_5d=ret_5d,
            range_compression=range_compression,
            realized_vol_pct=round(rvol_pct, 4),
            from_real_data=atr_20 is not None,
        )
    except Exception:
        logger.warning("get_market_features failed; using neutral fallback", exc_info=True)
        return fallback
