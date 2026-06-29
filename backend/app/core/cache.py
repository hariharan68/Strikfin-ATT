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
    """Shared Redis backend (async redis-py). Used only when REDIS_URL is set.

    Configured to FAIL FAST: if Redis is unreachable, ops raise in a few hundred
    milliseconds instead of retrying with backoff for seconds. The Cache facade
    then trips a circuit breaker and serves from the in-process cache, so a down
    Redis can never add latency to a request.
    """

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis  # imported lazily so redis is optional

        self._redis = redis.from_url(
            url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=0.25,  # cap each connect attempt
            socket_timeout=0.5,           # cap each read/write
            retry_on_timeout=False,       # do not retry — fail fast, fall back
            health_check_interval=30,     # re-probe a recovered connection
        )

    async def get(self, key: str) -> Optional[str]:
        return await self._redis.get(key)

    async def set(self, key: str, value: str, ttl: int) -> None:
        await self._redis.set(key, value, ex=ttl)


# ─────────────────────────────────────────────────────────────
# Cache facade
# ─────────────────────────────────────────────────────────────

class Cache:
    """Resilient cache facade.

    Correctness in every Redis state, with no request ever blocked:

      • Redis up   → shared Redis cache (fast, cross-worker).
      • Redis down → automatic in-process fallback (still fast); a circuit
                     breaker skips Redis for REDIS_COOLDOWN seconds so only the
                     first probe in each window pays the (tiny) timeout.
      • Recovery   → after the cooldown the next op re-probes Redis and, on
                     success, resumes using it. No restart needed.

    The in-process cache is written on every set (the keyspace is small and
    bounded), so the fallback is always warm if Redis trips mid-flight.
    """

    REDIS_COOLDOWN = 30.0  # seconds to skip a known-down Redis before re-probing

    def __init__(self) -> None:
        # The in-process cache is ALWAYS available as a fast fallback.
        self._memory = _InProcessBackend()
        self._redis: Optional[_RedisBackend] = None
        self._redis_down_until = 0.0
        self._warned = False

        if settings.REDIS_URL:
            try:
                self._redis = _RedisBackend(settings.REDIS_URL)
                self.kind = "redis (in-process fallback)"
            except Exception:
                logger.warning(
                    "REDIS_URL set but redis backend failed to init — "
                    "using in-process cache", exc_info=True,
                )
                self._redis = None
                self.kind = "in-process (redis init failed)"
        else:
            self.kind = "in-process"

    def _redis_available(self) -> bool:
        """True when Redis is configured and the circuit breaker is closed."""
        return self._redis is not None and time.time() >= self._redis_down_until

    def _trip(self) -> None:
        """Open the circuit so a dead/slow Redis is skipped for a cooldown."""
        self._redis_down_until = time.time() + self.REDIS_COOLDOWN
        self._warn_once()

    async def get_json(self, key: str) -> Optional[Any]:
        # Prefer Redis when it's believed healthy; fall back to memory on error.
        if self._redis_available():
            try:
                raw = await self._redis.get(key)  # type: ignore[union-attr]
                return json.loads(raw) if raw else None
            except Exception:
                self._trip()  # fall through to in-process
        try:
            raw = await self._memory.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return None  # treat any failure as a cache miss

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        try:
            data = json.dumps(value, default=str)
        except Exception:
            return  # un-serialisable value — never let it break the request

        # Always keep an in-process copy so reads stay fast even if Redis is
        # down now or trips between this write and the next read.
        try:
            await self._memory.set(key, data, ttl)
        except Exception:
            pass

        if self._redis_available():
            try:
                await self._redis.set(key, data, ttl)  # type: ignore[union-attr]
            except Exception:
                self._trip()  # never let a cache write block/break the request

    def _warn_once(self) -> None:
        if not self._warned:
            logger.warning(
                "Redis unreachable — serving from in-process cache "
                "(retrying every %.0fs)", self.REDIS_COOLDOWN, exc_info=True,
            )
            self._warned = True


# Module-level singleton imported everywhere.
cache = Cache()
