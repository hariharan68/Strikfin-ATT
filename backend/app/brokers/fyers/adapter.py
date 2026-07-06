"""
app/brokers/fyers/adapter.py
----------------------------
Fyers implementation of `BrokerAdapter`.

M2 strategy (strangler): this adapter **delegates to the existing, proven
`app.ingestion.providers.fyers_provider`** rather than rewriting it. That module
carries the hard-won rate-limit fix — the single batched `_refresh_all_spots`
quotes() call plus the last-good fallback — which must not regress. Wrapping it
gives us the uniform interface now with zero behavior change.

The provider still resolves symbols from its own in-module dicts keyed by
instrument_id. Those dicts move into this adapter (reading
`ref.vendor_symbols["fyers"]`) in M3, when the provider's remaining hardcoding
is removed and the Market Data Service owns the symbol resolution. Until then we
delegate by `ref.instrument_id`, which the provider already understands.
"""
from __future__ import annotations

from typing import Optional

from app.brokers.base import BrokerAdapter
from app.instruments import InstrumentRef


class FyersAdapter(BrokerAdapter):
    name = "fyers"
    supports_trading = False  # read-only market data in M2; trading in a later phase

    def get_spot(self, ref: InstrumentRef) -> dict:
        from app.ingestion.providers.fyers_provider import get_spot
        return get_spot(ref.instrument_id)

    def get_option_chain(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        from app.ingestion.providers.fyers_provider import get_option_chain
        return get_option_chain(ref.instrument_id, expiry_date)

    def get_futures(self, ref: InstrumentRef) -> dict:
        from app.ingestion.providers.fyers_provider import get_futures
        return get_futures(ref.instrument_id)

    def get_history(self, ref: InstrumentRef, days: int = 60, resolution: str = "D") -> dict:
        from app.ingestion.providers.fyers_provider import get_history
        return get_history(ref.instrument_id, days, resolution)

    def is_connected(self) -> bool:
        try:
            from app.ingestion.providers.fyers_provider import is_connected
            return bool(is_connected())
        except Exception:
            return False
