"""
app.instruments
---------------
Instrument Master domain: the single source of truth for what an instrument IS
(symbols, lot size, strike step, expiry rule, …). Replaces the hardcoded
{1: "NSE:NIFTY50-INDEX", 2: ...} dicts scattered across providers/services.

M0 introduces the read-through `InstrumentRef` resolver over the CURRENT
minimal `instruments` table. M1 extends the table + this module with the rich
columns (vendor_symbols, strike_step, expiry_rule, tick_size, instrument_type)
and the search/import endpoints.
"""
from app.instruments.ref import (
    InstrumentRef,
    InstrumentNotFound,
    resolve_instrument,
    resolve_active_instruments,
    invalidate_instrument_cache,
)
from app.instruments.service import (
    upsert_instruments,
    list_instruments,
    search_instruments,
    get_instrument,
)

__all__ = [
    "InstrumentRef",
    "InstrumentNotFound",
    "resolve_instrument",
    "resolve_active_instruments",
    "invalidate_instrument_cache",
    "upsert_instruments",
    "list_instruments",
    "search_instruments",
    "get_instrument",
]
