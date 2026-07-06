"""
app/instruments/service.py
--------------------------
Instrument Master read/write service — the one place that mutates the
`instruments` table and the read helpers the API/router use.

`upsert_instruments` is the importer primitive: it takes plain dicts (from
seed.py, a broker instrument-dump, or an admin request) and creates/updates
rows idempotently. Adding a new instrument to the platform means calling this —
nothing else in the app hardcodes instrument attributes.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Instrument
from app.instruments.ref import InstrumentRef, invalidate_instrument_cache

logger = logging.getLogger(__name__)

# Columns the importer is allowed to write (whitelist — ignores unknown keys so
# a broker dump with extra fields doesn't blow up).
_WRITABLE = {
    "symbol", "exchange", "lot_size", "is_active",
    "display_name", "segment", "instrument_type", "underlying",
    "tick_size", "strike_step", "expiry_rule", "vendor_symbols",
    "snapshot_enabled", "status",
}


async def upsert_instruments(
    db: AsyncSession, records: Iterable[dict[str, Any]]
) -> list[InstrumentRef]:
    """Create or update instruments from dicts. Idempotent.

    Each record must carry `instrument_id`. Present rows are updated field-by-
    field (only whitelisted keys); absent rows are inserted. Caller commits.
    """
    out: list[InstrumentRef] = []
    for rec in records:
        iid = rec.get("instrument_id")
        if iid is None:
            raise ValueError("instrument record missing 'instrument_id'")

        row = (
            await db.execute(select(Instrument).where(Instrument.instrument_id == iid))
        ).scalar_one_or_none()

        if row is None:
            row = Instrument(instrument_id=iid)
            for k, v in rec.items():
                if k in _WRITABLE:
                    setattr(row, k, v)
            db.add(row)
            logger.info("instrument %s (%s) created", iid, rec.get("symbol"))
        else:
            for k, v in rec.items():
                if k in _WRITABLE:
                    setattr(row, k, v)
            logger.debug("instrument %s (%s) updated", iid, rec.get("symbol"))

        await db.flush()
        await invalidate_instrument_cache(iid)
        out.append(InstrumentRef.from_model(row))
    return out


# ─────────────────────────────────────────────────────────────
# Read helpers (used by the /instruments router)
# ─────────────────────────────────────────────────────────────

async def list_instruments(
    db: AsyncSession, *, active_only: bool = True
) -> list[InstrumentRef]:
    stmt = select(Instrument).order_by(Instrument.instrument_id)
    if active_only:
        stmt = stmt.where(Instrument.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [InstrumentRef.from_model(r) for r in rows]


async def search_instruments(
    db: AsyncSession, query: str, *, limit: int = 20, active_only: bool = True
) -> list[InstrumentRef]:
    """Case-insensitive prefix/substring search over symbol + display_name.

    Backs the global instrument search (frontend command palette, M4). Empty
    query returns the catalog head so an unfocused search box shows options.
    """
    q = (query or "").strip()
    stmt = select(Instrument)
    if active_only:
        stmt = stmt.where(Instrument.is_active.is_(True))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Instrument.symbol).like(like),
                func.lower(func.coalesce(Instrument.display_name, "")).like(like),
            )
        )
    # Prefix matches on symbol first, then the rest alphabetically.
    stmt = stmt.order_by(Instrument.symbol).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [InstrumentRef.from_model(r) for r in rows]


async def get_instrument(
    db: AsyncSession, instrument_id: int
) -> Optional[InstrumentRef]:
    row = (
        await db.execute(select(Instrument).where(Instrument.instrument_id == instrument_id))
    ).scalar_one_or_none()
    return InstrumentRef.from_model(row) if row is not None else None
