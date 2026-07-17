"""
api/v1/routers/options_lab.py
------------------------------
Options Lab toolkit endpoints.

GET /api/v1/options-lab/oi/{instrument_id}
    Intraday Open-Interest view (OI@open → OI@now → change) per strike,
    plus spot, ATM, max pain, PCR and a sentiment read. Powers the
    Options Lab → Open Interest tool.

GET /api/v1/options-lab/oi-series/{instrument_id}
    Intraday time-series of OI / Volume / OI-change per strike across the day's
    snapshots. Powers the Options Lab → Multi OI & Volume tool.

GET /api/v1/options-lab/gex-series/{instrument_id}
    Raw per-snapshot chain data (OI + IV per leg, spot, expiry) for the Gamma
    Exposure tool. GEX math runs client-side (frontend/src/lib/gex.ts).
"""
from fastapi import APIRouter, Path, Query

from app.core.cache import cache, make_key
from app.core.config import settings
from app.core.deps import CurrentUserId, DBSession
from app.services.options_lab_service import OptionsLabService

router = APIRouter(prefix="/options-lab", tags=["options-lab"])


@router.get("/oi/{instrument_id}")
async def open_interest_view(
    instrument_id: int = Path(..., ge=1),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    key = make_key("lab:oi", instrument_id)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc  = OptionsLabService(db)
    data = await svc.get_oi_view(instrument_id)
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_OI)
    return data


@router.get("/oi-series/{instrument_id}")
async def oi_series_view(
    instrument_id: int = Path(..., ge=1),
    window: int = Query(20, ge=5, le=40, description="Strikes above/below ATM"),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    key = make_key("lab:oi-series", instrument_id, window)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc  = OptionsLabService(db)
    data = await svc.get_oi_series(instrument_id, window=window)
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_OI)
    return data


@router.get("/gex-series/{instrument_id}")
async def gex_series_view(
    instrument_id: int = Path(..., ge=1),
    window: int = Query(20, ge=5, le=40, description="Strikes above/below ATM"),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    key = make_key("lab:gex-series", instrument_id, window)
    cached = await cache.get_json(key)
    if cached is not None:
        return cached

    svc  = OptionsLabService(db)
    data = await svc.get_gex_series(instrument_id, window=window)
    await cache.set_json(key, data, ttl=settings.CACHE_TTL_OI)
    return data
