"""
app/brokers/registry.py
-----------------------
Resolves which `BrokerAdapter` serves a request.

M2: the choice is global — `settings.MARKET_DATA_VENDOR` ("mock" | "fyers") —
mirroring today's provider dispatcher, but returning a uniform adapter object
instead of module-level functions. Adapters are cached (they are stateless
wrappers over the providers' own caches).

Later phases layer richer resolution on top of the same entry point, without
changing callers:
  - per-instrument data source (`InstrumentRef` could name its vendor),
  - per-user connected broker (from `broker_connections`) for trading/live data,
  - automatic fallback to the mock adapter when a live vendor is down.
"""
from __future__ import annotations

import logging
from typing import Optional

from app.brokers.base import BrokerAdapter
from app.core.config import settings
from app.instruments import InstrumentRef

logger = logging.getLogger(__name__)

_ADAPTERS: dict[str, BrokerAdapter] = {}


def _build(vendor: str) -> BrokerAdapter:
    if vendor == "fyers":
        from app.brokers.fyers import FyersAdapter
        return FyersAdapter()
    # default / unknown → mock (safe, always available)
    from app.brokers.mock import MockAdapter
    return MockAdapter()


def get_adapter(vendor: str) -> BrokerAdapter:
    """Return the cached adapter for a vendor key ("fyers" | "mock")."""
    key = (vendor or "mock").lower()
    adapter = _ADAPTERS.get(key)
    if adapter is None:
        adapter = _build(key)
        _ADAPTERS[key] = adapter
        logger.debug("built %s broker adapter", adapter.name)
    return adapter


def get_market_data_adapter(ref: Optional[InstrumentRef] = None) -> BrokerAdapter:
    """The adapter that serves market data for `ref`.

    M2: global vendor from settings (ref is accepted now so callers already pass
    it and the per-instrument/per-user resolution can be added later with no
    call-site changes).
    """
    return get_adapter(settings.MARKET_DATA_VENDOR)


def reset_adapters() -> None:
    """Drop the adapter cache (used by tests / after a config change)."""
    _ADAPTERS.clear()
