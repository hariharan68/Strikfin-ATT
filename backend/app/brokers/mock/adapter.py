"""
app/brokers/mock/adapter.py
---------------------------
Mock implementation of `BrokerAdapter` — realistic-but-fake data, no vendor
account needed. Delegates to the existing `app.ingestion.providers.mock_provider`
(the strangler wrapper pattern, same as the Fyers adapter).

Used as the default data source in dev (MARKET_DATA_VENDOR=mock) and as the
last-resort fallback when a live vendor is unreachable.
"""
from __future__ import annotations

from typing import Optional

from app.brokers.base import BrokerAdapter
from app.instruments import InstrumentRef


class MockAdapter(BrokerAdapter):
    name = "mock"
    supports_trading = False

    def get_spot(self, ref: InstrumentRef) -> dict:
        from app.ingestion.providers.mock_provider import get_spot
        return get_spot(ref.instrument_id)

    def get_option_chain(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        from app.ingestion.providers.mock_provider import get_option_chain
        # mock_provider.get_option_chain takes an optional positional expiry.
        if expiry_date is None:
            return get_option_chain(ref.instrument_id)
        return get_option_chain(ref.instrument_id, expiry_date)

    def get_futures(self, ref: InstrumentRef) -> dict:
        from app.ingestion.providers.mock_provider import get_futures
        return get_futures(ref.instrument_id)

    def get_history(self, ref: InstrumentRef, days: int = 60, resolution: str = "D") -> dict:
        from app.ingestion.providers.mock_provider import get_history
        return get_history(ref.instrument_id, days, resolution)

    def is_connected(self) -> bool:
        return True  # mock is always "up"
