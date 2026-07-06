"""
app/websocket/router.py
-----------------------
Authenticated WebSocket endpoint.

    WSS /api/v1/ws?token=<access_token>

Protocol (JSON frames):
  client → server:
    {"action":"subscribe","channels":["quote:1","quote:2"]}
    {"action":"unsubscribe","channels":["quote:2"]}
    {"action":"ping"}
  server → client:
    {"type":"connected","user_id":N}
    {"type":"subscribed","channels":[...]}   (+ immediate snapshot per channel)
    {"type":"quote","channel":"quote:1","data":{...}}
    {"type":"pong"} / {"type":"error","message":"..."}

Browsers can't set Authorization headers on WebSockets, so the JWT is passed as
the `token` query param and validated the same way as HTTP requests.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.core.security import decode_access_token
from app.websocket import channels as ch
from app.websocket.manager import manager
from app.websocket.snapshots import fetch_channel_payload

logger = logging.getLogger(__name__)
router = APIRouter()


def _auth(token: Optional[str]) -> Optional[int]:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except JWTError:
        return None
    sub = payload.get("sub")
    return int(sub) if sub else None


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: Optional[str] = Query(None)):
    user_id = _auth(token)
    if user_id is None:
        await ws.close(code=1008)  # policy violation — bad/missing token
        return

    await manager.connect(ws)
    try:
        await ws.send_json({"type": "connected", "user_id": user_id})
        while True:
            msg = await ws.receive_json()
            await _handle(ws, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("ws error", exc_info=True)
    finally:
        await manager.disconnect(ws)


async def _handle(ws: WebSocket, msg: dict) -> None:
    action = (msg or {}).get("action")

    if action == "ping":
        await ws.send_json({"type": "pong"})
        return

    if action in ("subscribe", "unsubscribe"):
        requested = msg.get("channels") or []
        valid = [c for c in requested if ch.is_valid(c)]
        invalid = [c for c in requested if not ch.is_valid(c)]

        if action == "subscribe":
            await manager.subscribe(ws, valid)
            await ws.send_json({"type": "subscribed", "channels": valid})
            # Push an immediate snapshot so the client shows data at once.
            for c in valid:
                payload = await fetch_channel_payload(c)
                if payload is not None:
                    await ws.send_json({"type": payload["kind"], "channel": c, "data": payload["data"]})
        else:
            await manager.unsubscribe(ws, valid)
            await ws.send_json({"type": "unsubscribed", "channels": valid})

        if invalid:
            await ws.send_json({"type": "error", "message": f"Ignored invalid channels: {invalid}"})
        return

    await ws.send_json({"type": "error", "message": f"Unknown action: {action}"})
