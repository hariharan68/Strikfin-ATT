"""
app/instruments/ref.py
----------------------
`InstrumentRef` — a resolved, cached value object describing one instrument.

Why this exists
---------------
Today the identity of an instrument flows through the app as a bare int (1 or 2)
and every layer re-derives its properties from hardcoded dicts:

    fyers_provider._SPOT_SYMBOLS = {1: "NSE:NIFTY50-INDEX", 2: "BSE:SENSEX-INDEX"}
    options_math.LOT_SIZE        = {1: 65, 2: 20}
    mock_provider._STEP          = {1: 50, 2: 100}
    ...

`InstrumentRef` centralizes all of that behind one object loaded from the
`instruments` table and cached. Consumers ask the resolver for a ref and read
`ref.lot_size` / `ref.vendor_symbol("fyers")` / `ref.strike_step` instead of
reaching into a module-level dict keyed on a magic id.

M0 scope
--------
The current `instruments` table only has (instrument_id, symbol, exchange,
lot_size, is_active). The rich fields (vendor_symbols, strike_step, expiry_rule,
tick_size, instrument_type, display_name, segment) are modeled here as Optional
and populated in M1 once the table gains those columns. Nothing is wired into
the existing request path yet — this is additive plumbing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache, make_key
from app.db.models import Instrument

logger = logging.getLogger(__name__)

# Instrument master changes rarely — cache resolved refs for a few minutes.
_CACHE_NS = "instrument:ref"
_CACHE_TTL = 300


class InstrumentNotFound(Exception):
    """Raised when an instrument_id has no active row in the master."""

    def __init__(self, instrument_id: int) -> None:
        self.instrument_id = instrument_id
        super().__init__(f"Instrument {instrument_id} not found or inactive")


@dataclass(frozen=True, slots=True)
class InstrumentRef:
    """Immutable resolved view of an instrument.

    Read this instead of hardcoding per-id constants. `vendor_symbols` maps a
    data-source key (e.g. "fyers") to that vendor's symbol string; use
    `vendor_symbol()` to look one up with a graceful fallback.
    """

    instrument_id: int
    symbol: str
    exchange: str
    lot_size: int
    is_active: bool = True
    # Stable opaque external id (string form of the DB uuid) — the frontend/API
    # key off this, not the small integer id.
    uid: Optional[str] = None

    # ── Rich fields — populated in M1 (nullable until the columns exist) ──────
    display_name: Optional[str] = None
    segment: Optional[str] = None                 # e.g. INDEX | STOCK | FUT | OPT | COMMODITY
    instrument_type: Optional[str] = None         # e.g. INDEX | EQUITY | FUTIDX | OPTIDX
    underlying: Optional[str] = None
    tick_size: Optional[float] = None
    strike_step: Optional[float] = None           # replaces mock_provider._STEP / round(spot/50)
    expiry_rule: Optional[str] = None             # replaces the hardcoded last-Thursday builder
    vendor_symbols: dict = field(default_factory=dict)
    snapshot_enabled: bool = True                 # M3 scheduler iterates on this instead of (1, 2)
    status: Optional[str] = None                  # ACTIVE | DELISTED | SUSPENDED

    # ── Convenience ──────────────────────────────────────────────────────────
    @property
    def label(self) -> str:
        """Human-facing name — display_name if set, else the raw symbol."""
        return self.display_name or self.symbol

    def vendor_symbol(self, vendor: str, kind: str = "spot") -> Optional[str]:
        """Vendor-specific symbol string for a given kind, or None.

        `vendor_symbols` maps a vendor to a small map of symbol kinds, e.g.
            {"fyers": {"spot": "NSE:NIFTY50-INDEX",
                       "option": "NSE:NIFTY50-INDEX",
                       "futures_template": "NSE:NIFTY{yy}{mon}FUT"}}
        so `vendor_symbol("fyers")` → the spot symbol,
           `vendor_symbol("fyers", "futures_template")` → the futures template.
        A flat string value (vendor → "SYM") is also accepted for simple cases.
        """
        v = self.vendor_symbols.get(vendor)
        if isinstance(v, dict):
            return v.get(kind)
        return v

    def to_dict(self) -> dict:
        return {
            "instrument_id": self.instrument_id,
            "uid": self.uid,
            "symbol": self.symbol,
            "exchange": self.exchange,
            "lot_size": self.lot_size,
            "is_active": self.is_active,
            "display_name": self.display_name,
            "segment": self.segment,
            "instrument_type": self.instrument_type,
            "underlying": self.underlying,
            "tick_size": self.tick_size,
            "strike_step": self.strike_step,
            "expiry_rule": self.expiry_rule,
            "vendor_symbols": self.vendor_symbols,
            "snapshot_enabled": self.snapshot_enabled,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "InstrumentRef":
        return cls(
            instrument_id=int(d["instrument_id"]),
            symbol=d["symbol"],
            exchange=d["exchange"],
            lot_size=int(d["lot_size"]),
            is_active=bool(d.get("is_active", True)),
            uid=d.get("uid"),
            display_name=d.get("display_name"),
            segment=d.get("segment"),
            instrument_type=d.get("instrument_type"),
            underlying=d.get("underlying"),
            tick_size=d.get("tick_size"),
            strike_step=d.get("strike_step"),
            expiry_rule=d.get("expiry_rule"),
            vendor_symbols=d.get("vendor_symbols") or {},
            snapshot_enabled=bool(d.get("snapshot_enabled", True)),
            status=d.get("status"),
        )

    @classmethod
    def from_model(cls, m: Instrument) -> "InstrumentRef":
        """Build from the ORM row. Numeric master fields are DECIMAL in the DB;
        coerce to float here so consumers and JSON serialization see plain floats."""
        def _f(v: Any) -> Optional[float]:
            return float(v) if v is not None else None

        # getattr keeps this forward-compatible if columns are added/renamed.
        _uid = getattr(m, "uid", None)
        return cls(
            instrument_id=m.instrument_id,
            symbol=m.symbol,
            exchange=m.exchange,
            lot_size=m.lot_size,
            is_active=bool(m.is_active),
            uid=str(_uid) if _uid is not None else None,
            display_name=getattr(m, "display_name", None),
            segment=getattr(m, "segment", None),
            instrument_type=getattr(m, "instrument_type", None),
            underlying=getattr(m, "underlying", None),
            tick_size=_f(getattr(m, "tick_size", None)),
            strike_step=_f(getattr(m, "strike_step", None)),
            expiry_rule=getattr(m, "expiry_rule", None),
            vendor_symbols=getattr(m, "vendor_symbols", None) or {},
            snapshot_enabled=bool(getattr(m, "snapshot_enabled", True)),
            status=getattr(m, "status", None),
        )


# ─────────────────────────────────────────────────────────────
# Resolver (read-through cache over the instruments table)
# ─────────────────────────────────────────────────────────────

async def resolve_instrument(
    db: AsyncSession, instrument_id: int, *, use_cache: bool = True
) -> InstrumentRef:
    """Return the resolved ref for `instrument_id`, or raise InstrumentNotFound.

    Read-through cached (Redis-or-inprocess via the shared `cache` facade). Only
    active instruments resolve; inactive/unknown ids raise, so callers get a
    clean 404 instead of silently serving a hardcoded default.
    """
    key = make_key(_CACHE_NS, instrument_id)

    if use_cache:
        cached = await cache.get_json(key)
        if cached is not None:
            return InstrumentRef.from_dict(cached)

    row = (
        await db.execute(
            select(Instrument).where(Instrument.instrument_id == instrument_id)
        )
    ).scalar_one_or_none()

    if row is None or not row.is_active:
        raise InstrumentNotFound(instrument_id)

    ref = InstrumentRef.from_model(row)
    await cache.set_json(key, ref.to_dict(), ttl=_CACHE_TTL)
    return ref


async def resolve_active_instruments(db: AsyncSession) -> list[InstrumentRef]:
    """All active instruments, ordered by id. Used by the scheduler (M3) and the
    `/instruments` catalog endpoint (M1) so neither hardcodes `(1, 2)`."""
    rows = (
        await db.execute(
            select(Instrument)
            .where(Instrument.is_active.is_(True))
            .order_by(Instrument.instrument_id)
        )
    ).scalars().all()
    return [InstrumentRef.from_model(r) for r in rows]


async def invalidate_instrument_cache(instrument_id: int) -> None:
    """Drop a cached ref (call after editing an instrument in M1). Best-effort;
    entries also expire after `_CACHE_TTL`."""
    # The cache facade has no delete; overwrite with a already-expired marker is
    # unsafe, so we rely on TTL. Kept as an explicit hook for M1 where the cache
    # gains a delete(). No-op today beyond logging intent.
    logger.debug("instrument cache invalidation requested for %s (TTL-based)", instrument_id)
