"""
api/v1/routers/instruments.py
-----------------------------
Instrument Master catalog API — the DB-driven replacement for the frontend's
hardcoded 2-item INSTRUMENTS array.

    GET /api/v1/instruments             — active catalog
    GET /api/v1/instruments/search?q=   — global instrument search (M4 palette)
    GET /api/v1/instruments/{id}        — one instrument (404 if unknown)

Read-only and cached; adding/editing instruments goes through the importer
service (app.instruments.service.upsert_instruments).
"""
from fastapi import APIRouter, Path, Query, HTTPException, status

from app.core.deps import CurrentUserId, DBSession
from app.domain.schemas import InstrumentOut
from app.instruments import InstrumentRef, get_instrument, list_instruments, search_instruments

router = APIRouter(prefix="/instruments", tags=["instruments"])


def _to_out(ref: InstrumentRef) -> InstrumentOut:
    return InstrumentOut(
        instrument_id=ref.instrument_id,
        uid=ref.uid,
        symbol=ref.symbol,
        display_name=ref.display_name,
        label=ref.label,
        exchange=ref.exchange,
        segment=ref.segment,
        instrument_type=ref.instrument_type,
        underlying=ref.underlying,
        lot_size=ref.lot_size,
        tick_size=ref.tick_size,
        strike_step=ref.strike_step,
        expiry_rule=ref.expiry_rule,
        status=ref.status,
        is_active=ref.is_active,
    )


@router.get("", response_model=list[InstrumentOut])
async def catalog(
    db: DBSession,
    _uid: CurrentUserId = None,
    include_inactive: bool = Query(False, description="Include delisted/suspended instruments"),
):
    """The instrument catalog. Drives instrument tabs / pickers in the UI."""
    refs = await list_instruments(db, active_only=not include_inactive)
    return [_to_out(r) for r in refs]


@router.get("/search", response_model=list[InstrumentOut])
async def search(
    db: DBSession,
    _uid: CurrentUserId = None,
    q: str = Query("", description="Search text over symbol + display name"),
    limit: int = Query(20, ge=1, le=100),
):
    """Case-insensitive search for the global instrument palette (M4)."""
    refs = await search_instruments(db, q, limit=limit)
    return [_to_out(r) for r in refs]


@router.get("/{instrument_id}", response_model=InstrumentOut)
async def one(
    db: DBSession,
    instrument_id: int = Path(..., ge=1),
    _uid: CurrentUserId = None,
):
    """One instrument by id. 404 if unknown (no hardcoded id range)."""
    ref = await get_instrument(db, instrument_id)
    if ref is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "INSTRUMENT_NOT_FOUND", "message": f"No instrument with id {instrument_id}"},
        )
    return _to_out(ref)
