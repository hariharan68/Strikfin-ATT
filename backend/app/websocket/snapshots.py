"""
app/websocket/snapshots.py
--------------------------
Fetches the current payload for a WS channel via the broker-agnostic
`market_data` facade. Shared by the route (immediate snapshot on subscribe) and
the publisher loop, so both emit the identical shape.

Because it goes through `market_data` → the adapters' cached providers, polling a
channel many times per minute costs at most one upstream broker hit per TTL
window (the same rate-limit discipline the whole app relies on).
"""
from __future__ import annotations

from typing import Optional

from app.instruments import snapshot as instrument_snapshot
from app.market_data import market_data
from app.websocket import channels as ch


async def fetch_channel_payload(channel: str) -> Optional[dict]:
    """Return {"kind": <kind>, "data": {...}} for a channel, or None."""
    parsed = ch.parse(channel)
    if parsed is None:
        return None
    kind, instrument_id = parsed
    ref = instrument_snapshot.get(instrument_id)
    if ref is None:
        return None

    if kind == ch.QUOTE:
        s = await market_data.get_spot(ref)
        return {
            "kind": "quote",
            "data": {
                "instrument_id": instrument_id,
                "symbol": s.get("symbol"),
                "last_price": s.get("last_price"),
                "change_pct": s.get("change_pct"),
                "india_vix": s.get("india_vix"),
                "snap_ts": s.get("snap_ts"),
                "source": s.get("source"),
            },
        }

    if kind == ch.OI:
        oi = await market_data.get_open_interest(ref)
        return {
            "kind": "oi",
            "data": {
                "instrument_id": instrument_id,
                "total_call_oi": oi.get("total_call_oi"),
                "total_put_oi": oi.get("total_put_oi"),
                "pcr_oi": oi.get("pcr_oi"),
            },
        }

    return None
