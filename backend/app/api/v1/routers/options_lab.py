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
"""
from fastapi import APIRouter, Path, Query

from app.core.deps import CurrentUserId, DBSession
from app.services.options_lab_service import OptionsLabService

router = APIRouter(prefix="/options-lab", tags=["options-lab"])


@router.get("/oi/{instrument_id}")
async def open_interest_view(
    instrument_id: int = Path(..., ge=1, le=2),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    svc = OptionsLabService(db)
    return await svc.get_oi_view(instrument_id)


@router.get("/oi-series/{instrument_id}")
async def oi_series_view(
    instrument_id: int = Path(..., ge=1, le=2),
    window: int = Query(20, ge=5, le=40, description="Strikes above/below ATM"),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    svc = OptionsLabService(db)
    return await svc.get_oi_series(instrument_id, window=window)
