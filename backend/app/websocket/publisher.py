"""
app/websocket/publisher.py
--------------------------
Background loop that pushes live updates to WS subscribers.

Each tick it polls only the channels that currently have subscribers
(`manager.active_channels()`), fetches the payload via the shared
`fetch_channel_payload` (cached market-data path), and broadcasts to that
channel. No subscribers → no work.

M6 drives updates by polling the (cached) market-data facade — the fan-out
architecture is the valuable part. Swapping in a true broker WebSocket stream
later means feeding `manager.broadcast(...)` from the stream callback instead of
this poll loop; the route/manager/frontend are unchanged.
"""
from __future__ import annotations

import asyncio
import logging

from app.core.config import settings
from app.websocket.manager import manager
from app.websocket.snapshots import fetch_channel_payload

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


async def _loop() -> None:
    interval = max(1, getattr(settings, "WS_PUBLISH_INTERVAL_SECONDS", 3))
    while True:
        try:
            for channel in manager.active_channels():
                payload = await fetch_channel_payload(channel)
                if payload is not None:
                    await manager.broadcast(
                        channel,
                        {"type": payload["kind"], "channel": channel, "data": payload["data"]},
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("ws publisher tick failed", exc_info=True)
        await asyncio.sleep(interval)


def start_publisher() -> None:
    """Spawn the publisher task (idempotent). Called from app lifespan."""
    global _task
    if _task is not None:
        return
    loop = asyncio.get_event_loop()
    _task = loop.create_task(_loop(), name="ws-publisher")
    logger.info("✓ WS publisher started")


async def stop_publisher() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):
            pass
        _task = None
