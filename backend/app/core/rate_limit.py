"""
core/rate_limit.py
------------------
Lightweight in-memory sliding-window rate limiter.
No external dependency — uses a per-key deque of request timestamps.

Used to throttle sensitive endpoints (login, register) against
brute-force / credential-stuffing attacks.

NOTE: state lives in the process. For a multi-worker / multi-host
deployment, swap this for a Redis-backed limiter (e.g. slowapi + Redis).
For a single-process app this is sufficient.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    """
    Allows at most `max_requests` per `window_seconds` per key.
    Keys are typically client IP addresses.
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        """Records a hit for `key`. Raises 429 if the limit is exceeded."""
        now = time.monotonic()
        window_start = now - self.window_seconds
        hits = self._hits[key]

        # Drop timestamps that fell out of the window
        while hits and hits[0] < window_start:
            hits.popleft()

        if len(hits) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - hits[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code":    "RATE_LIMITED",
                    "message": "Too many attempts. Please try again later.",
                },
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)


# ── Shared limiter instances ──────────────────────────────────
# 5 attempts per minute per IP on auth endpoints.
_login_limiter = SlidingWindowLimiter(max_requests=5, window_seconds=60)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def login_rate_limit(request: Request) -> None:
    """
    FastAPI dependency — throttles auth endpoints per client IP.
    Raises 429 when the caller exceeds 5 requests / minute.
    """
    _login_limiter.check(_client_key(request))
