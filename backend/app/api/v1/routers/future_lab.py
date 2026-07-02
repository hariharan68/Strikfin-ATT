"""
api/v1/routers/future_lab.py
-----------------------------
GET /api/v1/future-lab/price-oi/{instrument_id}

Powers Future Lab → OI Tools → Price vs OI: intraday underlying price plotted
against total option Open Interest for the latest trading session.
"""
from fastapi import APIRouter, Path  # type: ignore[import]

from app.core.cache import cache, make_key
from app.core.config import settings
from app.core.deps import CurrentUserId, DBSession
from app.services.options_lab_service import OptionsLabService

router = APIRouter(prefix="/future-lab", tags=["future-lab"])


@router.get("/price-oi/{instrument_id}")
async def price_vs_oi(
    instrument_id: int = Path(..., ge=1, le=2),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    Dual-axis Price-vs-OI series:
      • price_series — dense intraday underlying price (index_live_data).
      • oi_series    — total call+put OI per option snapshot.
    See OptionsLabService.get_price_oi_series for the data-quality fallbacks.
    """
    key = make_key("flab:price-oi", instrument_id)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc = OptionsLabService(db)
    data = await svc.get_price_oi_series(instrument_id)
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_OI)
    return data
