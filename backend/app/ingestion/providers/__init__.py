"""
app/ingestion/providers/__init__.py
-----------------------------------
Provider selector. Routes market-data calls to the live Fyers provider or the
mock provider based on settings.MARKET_DATA_VENDOR.

Import these from `app.ingestion.providers` (not from a specific provider
module) so switching MARKET_DATA_VENDOR takes effect everywhere.
"""
from app.core.config import settings


def get_spot(instrument_id: int) -> dict:
    if settings.MARKET_DATA_VENDOR == "fyers":
        from app.ingestion.providers.fyers_provider import get_spot as _get_spot
        return _get_spot(instrument_id)
    from app.ingestion.providers.mock_provider import get_spot as _get_spot
    return _get_spot(instrument_id)


def get_option_chain(instrument_id: int, expiry_date=None) -> dict:
    if settings.MARKET_DATA_VENDOR == "fyers":
        from app.ingestion.providers.fyers_provider import (
            get_option_chain as _get_chain,
        )
        return _get_chain(instrument_id, expiry_date)
    from app.ingestion.providers.mock_provider import (
        get_option_chain as _get_chain,
    )
    if expiry_date is None:
        return _get_chain(instrument_id)
    return _get_chain(instrument_id, expiry_date)


def get_futures(instrument_id: int) -> dict:
    if settings.MARKET_DATA_VENDOR == "fyers":
        from app.ingestion.providers.fyers_provider import get_futures as _get_futures
        return _get_futures(instrument_id)
    from app.ingestion.providers.mock_provider import get_futures as _get_futures
    return _get_futures(instrument_id)


def get_news_headlines(limit: int = 8) -> list:
    """News is mock-only — Fyers does not provide a news feed."""
    from app.ingestion.providers.mock_provider import get_news_headlines as _fn
    return _fn(limit)


def get_institutional_activity(trade_date: str) -> list:
    """FII/DII activity is mock-only — Fyers does not provide EOD flow data."""
    from app.ingestion.providers.mock_provider import (
        get_institutional_activity as _fn,
    )
    return _fn(trade_date)
