"""
app.websocket
-------------
Real-time WebSocket layer (M6). Authenticated WSS with channel subscriptions
(`quote:{id}`, `oi:{id}`, …). A single upstream market-data poll fans out to all
subscribers via the ConnectionManager, so per-client connections never multiply
broker requests.

M6 uses in-process fan-out (single worker). Multi-worker fan-out slots in behind
the same ConnectionManager interface via Redis pub/sub — see the manager notes.
"""
from app.websocket.manager import ConnectionManager, manager

__all__ = ["ConnectionManager", "manager"]
