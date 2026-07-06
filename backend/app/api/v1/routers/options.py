"""
api/v1/routers/options.py
--------------------------
GET /api/v1/options/{instrument_id}/metrics
GET /api/v1/options/{instrument_id}/chain
"""
from fastapi import APIRouter, Path

from app.core.cache import cache, make_key
from app.core.config import settings
from app.core.deps import CurrentUserId, DBSession
from app.services.options_service import OptionsService

router = APIRouter(prefix="/options", tags=["options"])


# ─────────────────────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────────────────────

@router.get("/{instrument_id}/metrics")
async def options_metrics(
    instrument_id: int = Path(..., ge=1),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    Aggregated option chain metrics.

    Returns:
        PCR (OI + Volume)
        Max Pain strike
        OI-derived support + resistance
        Total call/put OI
        Writing posture
    """
    key = make_key("opt:metrics", instrument_id)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc     = OptionsService(db)
    metrics = await svc.get_latest_metrics(instrument_id)  # persist=False — read path
    data    = metrics.model_dump(mode="json")
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_METRICS)
    return data


# ─────────────────────────────────────────────────────────────
# FULL CHAIN
# ─────────────────────────────────────────────────────────────

@router.get("/{instrument_id}/chain")
async def options_chain(
    instrument_id: int = Path(..., ge=1),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    Full option chain with per-strike build-up classification.

    Each row includes:
        strike, option_type (CE/PE)
        ltp, oi, oi_change, volume
        iv, delta, theta, vega, gamma
        buildup_type (1-4), buildup_label

    Build-up labels:
        1  LONG_BUILDUP    price↑ oi↑ — fresh longs
        2  SHORT_BUILDUP   price↓ oi↑ — fresh shorts
        3  SHORT_COVERING  price↑ oi↓ — shorts exiting
        4  LONG_UNWINDING  price↓ oi↓ — longs exiting
    """
    key = make_key("opt:chain", instrument_id)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc  = OptionsService(db)
    data = await svc.get_chain_rows(instrument_id)
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_CHAIN)
    return data