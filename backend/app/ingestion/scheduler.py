"""
ingestion/scheduler.py
----------------------
Background ingestion + scoring loops, started from the FastAPI lifespan.

  • Index loop   — snapshots IndexLiveData every INGEST_INTERVAL_SECONDS so the
                   accuracy scorer has a real price path (and history accrues
                   for future analytics).
  • Option loop  — persists an option-chain snapshot every ~5 min (lighter
                   cadence; feeds the real IV-percentile history).
  • Scorer loop  — re-scores past signals against actual price every
                   SCORER_INTERVAL_SECONDS.

All loops are best-effort and never crash the app: every iteration is wrapped,
and a single failure just logs and waits for the next tick. Gated to market
hours (IST) when INGEST_MARKET_HOURS_ONLY is set.
"""
import asyncio
import logging
from datetime import date, datetime, time, timezone

try:
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")
except Exception:  # pragma: no cover — zoneinfo always present on 3.9+
    _IST = timezone.utc

from app.core.config import settings
from app.db.models import IndexLiveData
from app.db.session import AsyncSessionLocal
from app.ingestion.providers import get_spot
from app.services.options_service import OptionsService
from app.services.signal_outcome_service import SignalOutcomeService

logger = logging.getLogger(__name__)

_INSTRUMENTS = (1, 2)
_MARKET_OPEN = time(9, 15)
_MARKET_CLOSE = time(15, 30)

# Module-level handles so lifespan shutdown can cancel cleanly.
_tasks: list[asyncio.Task] = []


def is_market_open(now: datetime | None = None) -> bool:
    """True during NSE/BSE cash hours (Mon–Fri 09:15–15:30 IST)."""
    n = (now or datetime.now(timezone.utc)).astimezone(_IST)
    if n.weekday() >= 5:  # Sat/Sun
        return False
    return _MARKET_OPEN <= n.time() <= _MARKET_CLOSE


def _should_run() -> bool:
    return (not settings.INGEST_MARKET_HOURS_ONLY) or is_market_open()


async def _snapshot_index() -> None:
    """Write one IndexLiveData row per instrument from the live spot feed."""
    async with AsyncSessionLocal() as db:
        for iid in _INSTRUMENTS:
            try:
                s = get_spot(iid)
                ltp = float(s.get("last_price") or 0)
                # Don't pollute history with fallback/empty quotes.
                if ltp <= 0 or s.get("source") == "mock_fallback":
                    continue
                db.add(IndexLiveData(
                    instrument_id=iid,
                    trade_date=date.today(),
                    snap_ts=datetime.now(timezone.utc),
                    last_price=ltp,
                    open_price=s.get("open_price"),
                    high_price=s.get("high_price"),
                    low_price=s.get("low_price"),
                    prev_close=s.get("prev_close"),
                    change_pct=s.get("change_pct"),
                    volume=s.get("volume"),
                    india_vix=s.get("india_vix"),
                ))
            except Exception:
                logger.warning("index snapshot failed for instrument %s", iid, exc_info=True)
        await db.commit()


async def _snapshot_options() -> None:
    """Persist an option-chain snapshot per instrument (feeds IV history)."""
    async with AsyncSessionLocal() as db:
        svc = OptionsService(db)
        for iid in _INSTRUMENTS:
            try:
                await svc.get_latest_metrics(iid)  # persists snapshot as a side effect
            except Exception:
                logger.warning("option snapshot failed for instrument %s", iid, exc_info=True)


async def _index_loop() -> None:
    interval = max(15, settings.INGEST_INTERVAL_SECONDS)
    opt_every = max(1, (5 * 60) // interval)  # ~5-min option cadence
    tick = 0
    while True:
        try:
            if _should_run():
                await _snapshot_index()
                if tick % opt_every == 0:
                    await _snapshot_options()
            tick += 1
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ingestion loop iteration failed")
        await asyncio.sleep(interval)


async def _scorer_loop() -> None:
    interval = max(60, settings.SCORER_INTERVAL_SECONDS)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await SignalOutcomeService(db).score_pending()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scorer loop iteration failed")
        await asyncio.sleep(interval)


def start_background_jobs() -> None:
    """Spawn the ingestion + scorer tasks. Idempotent."""
    if not settings.INGEST_ENABLED:
        logger.info("Ingestion disabled (INGEST_ENABLED=false) — skipping background jobs")
        return
    if _tasks:
        return
    loop = asyncio.get_event_loop()
    _tasks.append(loop.create_task(_index_loop(), name="ingest-index"))
    _tasks.append(loop.create_task(_scorer_loop(), name="signal-scorer"))
    logger.info(
        "✓ Background jobs started (ingest=%ss, scorer=%ss, market_hours_only=%s)",
        settings.INGEST_INTERVAL_SECONDS,
        settings.SCORER_INTERVAL_SECONDS,
        settings.INGEST_MARKET_HOURS_ONLY,
    )


async def stop_background_jobs() -> None:
    """Cancel and await the background tasks on shutdown."""
    for t in _tasks:
        t.cancel()
    for t in _tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
    _tasks.clear()
    logger.info("✓ Background jobs stopped")
