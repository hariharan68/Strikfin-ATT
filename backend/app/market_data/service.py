"""
app/market_data/service.py
--------------------------
`MarketDataService` — the broker-agnostic facade for all market data.

Responsibilities
----------------
- Resolve the serving `BrokerAdapter` for an instrument (via the registry).
- Run the sync adapter call in a threadpool so the async request path never
  blocks on a vendor SDK.
- Return the same dict shapes the app already consumes (no consumer churn).

Two call styles:
  • `by_ref(...)`   — you already resolved an `InstrumentRef` (preferred; used by
                      M3 routers that depend on `get_instrument_ref`).
  • `by_id(db, id)` — convenience that resolves the ref first (used by the
                      scheduler and any caller holding only an id + db session).

Caching, TTLs, rate-limit batching and last-good fallback still live inside the
adapters/providers, so this facade stays thin.
"""
from __future__ import annotations

import logging
from typing import Optional

from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.brokers.registry import get_market_data_adapter
from app.instruments import InstrumentRef, resolve_instrument

logger = logging.getLogger(__name__)


class MarketDataService:
    """Thin async orchestration over the broker adapters."""

    # ── by resolved ref (preferred) ──────────────────────────────────────────
    async def get_spot(self, ref: InstrumentRef) -> dict:
        adapter = get_market_data_adapter(ref)
        return await run_in_threadpool(adapter.get_spot, ref)

    async def get_option_chain(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        adapter = get_market_data_adapter(ref)
        return await run_in_threadpool(adapter.get_option_chain, ref, expiry_date)

    async def get_futures(self, ref: InstrumentRef) -> dict:
        adapter = get_market_data_adapter(ref)
        return await run_in_threadpool(adapter.get_futures, ref)

    async def get_history(self, ref: InstrumentRef, days: int = 60, resolution: str = "D") -> dict:
        adapter = get_market_data_adapter(ref)
        return await run_in_threadpool(adapter.get_history, ref, days, resolution)

    async def get_open_interest(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        adapter = get_market_data_adapter(ref)
        return await run_in_threadpool(adapter.get_open_interest, ref, expiry_date)

    def adapter_name(self, ref: Optional[InstrumentRef] = None) -> str:
        return get_market_data_adapter(ref).name

    # ── by id + db (convenience) ─────────────────────────────────────────────
    async def _ref(self, db: AsyncSession, instrument_id: int) -> InstrumentRef:
        return await resolve_instrument(db, instrument_id)

    async def spot_by_id(self, db: AsyncSession, instrument_id: int) -> dict:
        return await self.get_spot(await self._ref(db, instrument_id))

    async def option_chain_by_id(
        self, db: AsyncSession, instrument_id: int, expiry_date: Optional[str] = None
    ) -> dict:
        return await self.get_option_chain(await self._ref(db, instrument_id), expiry_date)

    async def futures_by_id(self, db: AsyncSession, instrument_id: int) -> dict:
        return await self.get_futures(await self._ref(db, instrument_id))

    async def history_by_id(
        self, db: AsyncSession, instrument_id: int, days: int = 60, resolution: str = "D"
    ) -> dict:
        return await self.get_history(await self._ref(db, instrument_id), days, resolution)


# Module-level singleton — import `market_data` and call its methods.
market_data = MarketDataService()
