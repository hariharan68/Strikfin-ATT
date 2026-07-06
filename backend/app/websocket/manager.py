"""
app/websocket/manager.py
------------------------
In-process WebSocket connection manager: tracks live connections and which
channels each is subscribed to, and broadcasts a payload to every subscriber of
a channel.

Fan-out model
-------------
The publisher polls each ACTIVE channel once and calls `broadcast(channel, ...)`;
the manager delivers to all subscribers. So N clients watching `quote:1` cost one
upstream fetch, not N — the same rate-limit discipline as the rest of the app.

Scaling to multiple workers: keep this interface, and have `broadcast` publish to
a Redis channel and each worker's manager subscribe — subscribers on any worker
then receive it. The route/publisher code is unchanged. (M6 ships single-worker
in-process; the Redis bridge is the documented next step.)
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from starlette.websockets import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # channel -> set of connections subscribed to it
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)
        # connection -> set of its channels (for clean teardown)
        self._conn_channels: dict[WebSocket, set[str]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conn_channels[ws] = set()

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            for ch in self._conn_channels.pop(ws, set()):
                subs = self._subs.get(ch)
                if subs:
                    subs.discard(ws)
                    if not subs:
                        self._subs.pop(ch, None)

    async def subscribe(self, ws: WebSocket, channels: list[str]) -> None:
        async with self._lock:
            for ch in channels:
                self._subs[ch].add(ws)
                self._conn_channels[ws].add(ch)

    async def unsubscribe(self, ws: WebSocket, channels: list[str]) -> None:
        async with self._lock:
            for ch in channels:
                self._subs.get(ch, set()).discard(ws)
                self._conn_channels.get(ws, set()).discard(ch)
                if ch in self._subs and not self._subs[ch]:
                    self._subs.pop(ch, None)

    def active_channels(self) -> list[str]:
        """Channels with at least one subscriber — the set the publisher polls."""
        return [ch for ch, subs in self._subs.items() if subs]

    async def broadcast(self, channel: str, message: dict[str, Any]) -> None:
        """Send `message` to every subscriber of `channel`. Dead sockets are
        pruned. Never raises."""
        subs = list(self._subs.get(channel, set()))
        if not subs:
            return
        dead: list[WebSocket] = []
        for ws in subs:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    @property
    def connection_count(self) -> int:
        return len(self._conn_channels)


# Module-level singleton shared by the WS route and the publisher.
manager = ConnectionManager()
