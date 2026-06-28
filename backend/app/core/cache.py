"""
core/cache.py
-------------
Redis-ready hot cache for expensive computed responses (option metrics, PCR,
multi-strike OI graphs).

Design goals
------------
• One API, two backends. With REDIS_URL unset we use a tiny in-process TTL
  dict (perfect for single-process dev). Set REDIS_URL and the *same* calls
  transparently use a shared Redis instance across workers/restarts — no code
  change anywhere else.
• Never break a request. Every cache operation is best-effort: any backend
  error degrades to a cache miss / no-op and is logged, so a Redis outage can
  never take the app down.

Usage
-----
    from app.core.cache import cache

    cached = await cache.get_json(key)
    if cached is not None:
        return cached
    data = expensive()
    await cache.set_json(key, data, ttl=30)
    return data
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def make_key(*parts: Any) -> str:
    """Build a namespaced cache key, e.g. make_key('opt:metrics', 1) -> 'opt:metrics:1'."""
    return ":".join(str(p) for p in parts)


# ─────────────────────────────────────────────────────────────
# Backends
# ─────────────────────────────────────────────────────────────

class _InProcessBackend:
    """Per-process dict with per-key expiry. Lost on restart; not shared."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}

    async def get(self, key: str) -> Optional[str]:
        rec = self._store.get(key)
        if rec is None:
            return None
        expires_at, value = rec
        if expires_at < time.time():
            self._store.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: str, ttl: int) -> None:
        self._store[key] = (time.time() + ttl, value)


class _RedisBackend:
    """Shared Redis backend (async redis-py). Used only when REDIS_URL is set."""

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis  # imported lazily so redis is optional

        self._redis = redis.from_url(url, encoding="utf-8", decode_responses=True)

    async def get(self, key: str) -> Optional[str]:
        return await self._redis.get(key)

    async def set(self, key: str, value: str, ttl: int) -> None:
        await self._redis.set(key, value, ex=ttl)


# ─────────────────────────────────────────────────────────────
# Cache facade
# ─────────────────────────────────────────────────────────────

class Cache:
    def __init__(self) -> None:
        self._backend: Any
        if settings.REDIS_URL:
            try:
                self._backend = _RedisBackend(settings.REDIS_URL)
                self.kind = "redis"
            except Exception:
                logger.warning(
                    "REDIS_URL set but redis backend failed to init — "
                    "falling back to in-process cache", exc_info=True,
                )
                self._backend = _InProcessBackend()
                self.kind = "in-process (redis init failed)"
        else:
            self._backend = _InProcessBackend()
            self.kind = "in-process"
        self._warned = False

    async def get_json(self, key: str) -> Optional[Any]:
        try:
            raw = await self._backend.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            self._warn_once()
            return None  # treat any failure as a cache miss

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        try:
            await self._backend.set(key, json.dumps(value, default=str), ttl)
        except Exception:
            self._warn_once()  # never let a cache write break the request

    def _warn_once(self) -> None:
        if not self._warned:
            logger.warning("cache backend error — degrading to no-cache", exc_info=True)
            self._warned = True


# Module-level singleton imported everywhere.
cache = Cache()
