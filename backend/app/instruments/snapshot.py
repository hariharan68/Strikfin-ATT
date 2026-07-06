"""
app/instruments/snapshot.py
---------------------------
A **synchronous**, in-process mirror of the Instrument Master.

Why a second cache (vs InstrumentRef's async resolver)? The market-data
providers (`fyers_provider`, `mock_provider`) are synchronous and run on the hot
path with no DB session — they cannot `await` the async resolver. This module
holds a plain dict of `InstrumentRef`s that async code hydrates from the DB
(at startup, periodically from the scheduler, and after an instrument upsert),
so the sync providers can read symbols / strike_step / expiry_rule from the
master instead of hardcoded per-id dicts.

If it hasn't been hydrated yet, it lazily seeds itself from
`app.instruments.seed.DEFAULT_INSTRUMENTS` (the sanctioned data source), so the
built-in instruments always resolve even before the first async refresh.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.instruments.ref import InstrumentRef, resolve_active_instruments

logger = logging.getLogger(__name__)

_SNAPSHOT: dict[int, InstrumentRef] = {}
_lock = threading.RLock()


def _seed_if_empty() -> None:
    if _SNAPSHOT:
        return
    from app.instruments.seed import DEFAULT_INSTRUMENTS
    with _lock:
        if _SNAPSHOT:
            return
        for rec in DEFAULT_INSTRUMENTS:
            ref = InstrumentRef.from_dict(rec)
            _SNAPSHOT[ref.instrument_id] = ref
        logger.debug("instrument snapshot lazily seeded from defaults (%d)", len(_SNAPSHOT))


# ── Sync reads (hot path) ────────────────────────────────────────────────────
def get(instrument_id: int) -> Optional[InstrumentRef]:
    _seed_if_empty()
    return _SNAPSHOT.get(instrument_id)


def all_active() -> list[InstrumentRef]:
    _seed_if_empty()
    return sorted(
        (r for r in _SNAPSHOT.values() if r.is_active),
        key=lambda r: r.instrument_id,
    )


def snapshot_enabled_ids() -> list[int]:
    """Ids the ingestion scheduler should snapshot (active + snapshot_enabled)."""
    return [r.instrument_id for r in all_active() if r.snapshot_enabled]


def is_known(instrument_id: int) -> bool:
    _seed_if_empty()
    return instrument_id in _SNAPSHOT


def lot_size(instrument_id: int, default: int = 65) -> int:
    """Contract lot size from the master (replaces options_math.LOT_SIZE)."""
    r = get(instrument_id)
    return int(r.lot_size) if r and r.lot_size else default


def strike_step(instrument_id: int, default: float = 50.0) -> float:
    """Strike step from the master (replaces round(spot/50) / mock _STEP)."""
    r = get(instrument_id)
    return float(r.strike_step) if r and r.strike_step else default


# ── Async hydration (called from startup / scheduler / after upsert) ─────────
async def refresh(db: AsyncSession) -> int:
    """Reload the snapshot from the DB. Returns the number of active instruments."""
    refs = await resolve_active_instruments(db)
    with _lock:
        _SNAPSHOT.clear()
        for r in refs:
            _SNAPSHOT[r.instrument_id] = r
    logger.debug("instrument snapshot refreshed from DB (%d active)", len(refs))
    return len(refs)
