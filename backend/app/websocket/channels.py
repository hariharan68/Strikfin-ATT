"""
app/websocket/channels.py
-------------------------
Channel naming + validation for WS subscriptions.

Channel grammar: "<kind>:<selector>" e.g.
    quote:1              — spot quote for instrument 1
    oi:1                 — aggregate OI for instrument 1
    chain:1:2026-07-31   — option chain for instrument 1, an expiry (reserved)

Only market-data channels are exposed in M6; tenant/user channels (alerts,
orders) are reserved for later modules.
"""
from __future__ import annotations

from typing import Optional

# kinds a client may subscribe to in M6
QUOTE = "quote"
OI = "oi"
_MARKET_KINDS = {QUOTE, OI}


def quote_channel(instrument_id: int) -> str:
    return f"{QUOTE}:{instrument_id}"


def oi_channel(instrument_id: int) -> str:
    return f"{OI}:{instrument_id}"


def parse(channel: str) -> Optional[tuple[str, int]]:
    """Return (kind, instrument_id) for a valid market channel, else None."""
    parts = (channel or "").split(":")
    if len(parts) < 2:
        return None
    kind, sel = parts[0], parts[1]
    if kind not in _MARKET_KINDS:
        return None
    try:
        return kind, int(sel)
    except ValueError:
        return None


def is_valid(channel: str) -> bool:
    return parse(channel) is not None
