"""
app/instruments/seed.py
-----------------------
Canonical seed data for the Instrument Master.

This is the single Python-side source of truth for the built-in instruments
(NIFTY 50, SENSEX). It replaces the values that used to be hardcoded across the
providers/engines:

    fyers_provider._SPOT_SYMBOLS / _OPTION_SYMBOLS   → vendor_symbols["fyers"]
    fyers_provider._near_month_futures_symbol()      → vendor_symbols["fyers"]["futures_template"] + expiry_rule
    mock_provider._STEP                              → strike_step
    options_math.LOT_SIZE                            → lot_size
    options_lab_service._SYMBOLS / index._SYMBOLS    → display_name

`_seed_instruments()` in app/main.py upserts these on startup (fresh dev DBs).
The equivalent one-time UPDATE for the already-live DB lives in the Alembic
migration `debc9e15fc9b_instrument_master_rich_columns` — keep the two in sync.

Adding a new instrument = add a dict here (and let the importer service create
the row). Nothing else in the app should hardcode instrument attributes.
"""
from __future__ import annotations

from typing import Any

# expiry_rule vocabulary (interpreted by the generic expiry engine in M3):
#   MONTHLY_LAST_THU  — monthly expiry on the last Thursday (current behavior for
#                       both NIFTY & SENSEX futures in fyers_provider today).
# M3 adds WEEKLY_* and per-exchange calendar rules.

DEFAULT_INSTRUMENTS: list[dict[str, Any]] = [
    {
        "instrument_id": 1,
        "symbol": "NIFTY50",
        "display_name": "NIFTY 50",
        "exchange": "NSE",
        "segment": "INDEX",
        "instrument_type": "INDEX",
        "underlying": None,
        "lot_size": 65,
        "tick_size": 0.05,
        "strike_step": 50,
        "expiry_rule": "MONTHLY_LAST_THU",
        "vendor_symbols": {
            "fyers": {
                "spot": "NSE:NIFTY50-INDEX",
                "option": "NSE:NIFTY50-INDEX",
                "futures_template": "NSE:NIFTY{yy}{mon}FUT",
            }
        },
        "snapshot_enabled": True,
        "status": "ACTIVE",
        "is_active": True,
    },
    {
        "instrument_id": 2,
        "symbol": "SENSEX",
        "display_name": "SENSEX",
        "exchange": "BSE",
        "segment": "INDEX",
        "instrument_type": "INDEX",
        "underlying": None,
        "lot_size": 20,
        "tick_size": 0.05,
        "strike_step": 100,
        "expiry_rule": "MONTHLY_LAST_THU",
        "vendor_symbols": {
            "fyers": {
                "spot": "BSE:SENSEX-INDEX",
                "option": "BSE:SENSEX-INDEX",
                "futures_template": "BSE:SENSEX{yy}{mon}FUT",
            }
        },
        "snapshot_enabled": True,
        "status": "ACTIVE",
        "is_active": True,
    },
]
