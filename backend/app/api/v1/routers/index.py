"""
api/v1/routers/index.py
------------------------
GET /api/v1/index/{instrument_id}/snapshot
GET /api/v1/index/{instrument_id}/levels
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Path

from app.core.deps import CurrentUserId, DBSession
from app.domain.schemas import IndexLevels, IndexSnapshot
from app.engines.options_math import ChainRow, atm_strike, oi_walls
from app.ingestion.providers import get_option_chain, get_spot, get_futures
from app.engines.short_covering import detect_short_covering

router = APIRouter(prefix="/index", tags=["index"])

_SYMBOLS = {1: "NIFTY50", 2: "SENSEX"}


# ─────────────────────────────────────────────────────────────
# SNAPSHOT
# ─────────────────────────────────────────────────────────────

@router.get(
    "/{instrument_id}/snapshot",
    response_model=IndexSnapshot,
)
async def snapshot(
    instrument_id: int = Path(..., ge=1, le=2),
    _uid: CurrentUserId = None,
):
    """
    Live index snapshot.
    Returns LTP, OHLC, % change, India VIX.
    In production this reads from Redis hot cache first.
    """
    data = get_spot(instrument_id)

    return IndexSnapshot(
        instrument_id=instrument_id,
        symbol=_SYMBOLS.get(instrument_id, "UNKNOWN"),
        last_price=data["last_price"],
        open_price=data.get("open_price"),
        high_price=data.get("high_price"),
        low_price=data.get("low_price"),
        prev_close=data.get("prev_close"),
        change_pct=data.get("change_pct"),
        india_vix=data.get("india_vix"),
        snap_ts=datetime.now(timezone.utc),
    )


# ─────────────────────────────────────────────────────────────
# LEVELS
# ─────────────────────────────────────────────────────────────

@router.get(
    "/{instrument_id}/levels",
    response_model=IndexLevels,
)
async def levels(
    instrument_id: int = Path(..., ge=1, le=2),
    _uid: CurrentUserId = None,
):
    """
    OI-derived support and resistance zones.

    Support    = strike with highest Put OI below spot.
    Resistance = strike with highest Call OI above spot.

    These are probabilistic zones, not guaranteed price levels.
    """
    spot_data  = get_spot(instrument_id)
    spot       = spot_data["last_price"]
    change_pct = spot_data.get("change_pct", 0.0) or 0.0

    chain_data = get_option_chain(instrument_id)
    raw_rows   = chain_data["rows"]

    engine_rows = [
        ChainRow(
            strike=r["strike"],
            opt_type=r["option_type"],
            oi=r.get("oi", 0) or 0,
            oi_change=r.get("oi_change", 0) or 0,
            ltp=r.get("ltp", 0.0) or 0.0,
            volume=r.get("volume", 0) or 0,
            price_change=change_pct,
        )
        for r in raw_rows
    ]

    strikes = sorted({r.strike for r in engine_rows})
    atm     = atm_strike(spot, strikes)
    walls   = oi_walls(engine_rows, spot)

    return IndexLevels(
        instrument_id=instrument_id,
        symbol=_SYMBOLS.get(instrument_id, "UNKNOWN"),
        spot=spot,
        atm_strike=atm,
        support_zone=walls.get("support"),
        resistance_zone=walls.get("resistance"),
        as_of=datetime.now(timezone.utc),
    )


# ─────────────────────────────────────────────────────────────
# FUTURES
# ─────────────────────────────────────────────────────────────

@router.get("/{instrument_id}/futures")
async def futures(
    instrument_id: int = Path(..., ge=1, le=2),
    _uid: CurrentUserId = None,
):
    """
    Live near-month futures price and volume for NIFTY or SENSEX.
    Rolls to next month automatically after expiry Thursday.
    """
    data = get_futures(instrument_id)
    return {
        "instrument_id":  instrument_id,
        "symbol":         data.get("symbol"),
        "futures_symbol": data.get("futures_symbol"),
        "last_price":     data.get("last_price"),
        "prev_close":     data.get("prev_close"),
        "change":         data.get("change"),
        "change_pct":     data.get("change_pct"),
        "volume":         data.get("volume"),
        "open_price":     data.get("open_price"),
        "high_price":     data.get("high_price"),
        "low_price":      data.get("low_price"),
        "snap_ts":        datetime.now(timezone.utc).isoformat(),
        "source":         data.get("source"),
    }


# ─────────────────────────────────────────────────────────────
# SHORT COVERING DETECTION
# ─────────────────────────────────────────────────────────────

@router.get("/{instrument_id}/short-covering")
async def short_covering(
    instrument_id: int = Path(..., ge=1, le=2),
    _uid: CurrentUserId = None,
):
    """
    Detects whether a short covering rally is in progress.

    Scores 6 signals — Call OI unwinding, day-low recovery, bearish open,
    volume spike, support bounce, and time window — and returns a
    0–100 confidence score with a plain-English verdict.
    """
    spot_data    = get_spot(instrument_id)
    chain_data   = get_option_chain(instrument_id)
    futures_data = get_futures(instrument_id)

    # Attach support from OI walls into chain dict so the engine can use it
    from app.engines.options_math import ChainRow, oi_walls, atm_strike, pcr_oi
    raw_rows = chain_data.get("rows", [])
    change_pct = spot_data.get("change_pct", 0.0) or 0.0

    engine_rows = [
        ChainRow(
            strike=r["strike"],
            opt_type=r["option_type"],
            oi=r.get("oi", 0) or 0,
            oi_change=r.get("oi_change", 0) or 0,
            ltp=r.get("ltp", 0.0) or 0.0,
            volume=r.get("volume", 0) or 0,
            price_change=change_pct,
        )
        for r in raw_rows
    ]

    walls = oi_walls(engine_rows, spot_data.get("last_price", 0))
    chain_data["support"]    = walls.get("support")
    chain_data["resistance"] = walls.get("resistance")

    result = detect_short_covering(spot_data, chain_data, futures_data)

    return {
        "instrument_id":       instrument_id,
        "status":              result.status,
        "score":               result.score,
        "confidence_pct":      result.confidence_pct,
        "is_post_noon":        result.is_post_noon,
        "verdict":             result.verdict,
        "recovery_pct":        result.recovery_pct,
        "call_oi_change":      result.call_oi_change,
        "put_oi_change":       result.put_oi_change,
        "pcr":                 result.pcr,
        "support_level":       result.support_level,
        "near_support":        result.near_support,
        "futures_volume":      result.futures_volume,
        "day_open":            result.day_open,
        "day_low":             result.day_low,
        "day_high":            result.day_high,
        "ltp":                 result.ltp,
        "change_from_open_pct": result.change_from_open_pct,
        "factors": [
            {
                "name":        f.name,
                "fired":       f.fired,
                "value":       f.value,
                "description": f.description,
            }
            for f in result.factors
        ],
        "snap_ts": datetime.now(timezone.utc).isoformat(),
    }