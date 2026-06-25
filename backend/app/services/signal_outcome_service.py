"""
services/signal_outcome_service.py
----------------------------------
Closes the feedback loop: scores past AI signals against what price actually
did, and aggregates a win-rate / expectancy scorecard. This is what turns the
synthesizer from "trust me" into a measurable, improvable system.

Price path = the stored IndexLiveData snapshots between a signal's timestamp
and its evaluation horizon. We use each snapshot's last price as a path point
(robust to the day-cumulative high/low fields); a future upgrade can swap in
true intraday bar highs/lows from the history feed for finer touch detection.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import AITradeSignal, IndexLiveData, SignalOutcome
from app.engines.outcome import OPEN, WIN, LOSS, EXPIRED, evaluate_path

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _price_path(
    db: AsyncSession,
    instrument_id: int,
    start: datetime,
    end: datetime,
) -> list[dict]:
    """Ordered list of {high, low, close} points from stored index snapshots."""
    stmt = (
        select(IndexLiveData.last_price, IndexLiveData.snap_ts)
        .where(
            IndexLiveData.instrument_id == instrument_id,
            IndexLiveData.snap_ts > start,
            IndexLiveData.snap_ts <= end,
        )
        .order_by(IndexLiveData.snap_ts.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        {"high": float(p), "low": float(p), "close": float(p)}
        for (p, _ts) in rows
        if p is not None
    ]


class SignalOutcomeService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.horizon = timedelta(hours=settings.SIGNAL_EVAL_HORIZON_HOURS)

    async def score_pending(self, instrument_id: int | None = None, lookback_days: int = 30) -> dict:
        """
        Evaluate every signal in the lookback window that isn't yet resolved
        (no outcome, or an OPEN one). Persists/updates a SignalOutcome per
        signal. Returns a small counts summary.
        """
        now = _utcnow()
        since = now - timedelta(days=lookback_days)

        sig_stmt = select(AITradeSignal).where(AITradeSignal.as_of >= since)
        if instrument_id is not None:
            sig_stmt = sig_stmt.where(AITradeSignal.instrument_id == instrument_id)
        signals = (await self.db.execute(sig_stmt)).scalars().all()

        # Existing outcomes keyed by signal_id (to skip already-resolved ones).
        out_stmt = select(SignalOutcome)
        if instrument_id is not None:
            out_stmt = out_stmt.where(SignalOutcome.instrument_id == instrument_id)
        existing = {o.signal_id: o for o in (await self.db.execute(out_stmt)).scalars().all()}

        counts = {"evaluated": 0, "resolved": 0, "open": 0, "skipped": 0}

        for sig in signals:
            prior = existing.get(sig.id)
            if prior is not None and prior.status != OPEN:
                counts["skipped"] += 1
                continue

            as_of = sig.as_of
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=timezone.utc)
            horizon_end = as_of + self.horizon
            horizon_elapsed = now >= horizon_end
            path = await self._price_path_safe(sig.instrument_id, as_of, min(horizon_end, now))

            result = evaluate_path(
                bias=sig.bias,
                entry=float(sig.entry_ref) if sig.entry_ref is not None else None,
                stop=float(sig.stop_ref) if sig.stop_ref is not None else None,
                target=float(sig.target_ref) if sig.target_ref is not None else None,
                bars=path,
                horizon_elapsed=horizon_elapsed,
            )
            # Horizon passed with no usable price path → terminal EXPIRED with
            # no R, so it isn't re-scored forever and doesn't skew the win rate.
            status = result.status
            if status == OPEN and horizon_elapsed:
                status = EXPIRED

            counts["evaluated"] += 1
            if status == OPEN:
                counts["open"] += 1
            else:
                counts["resolved"] += 1

            if prior is not None:
                prior.status = status
                prior.realized_r = result.realized_r
                prior.exit_price = result.exit_price
                prior.bars_held = result.bars_held
                prior.evaluated_at = now
            else:
                self.db.add(SignalOutcome(
                    signal_id=sig.id,
                    instrument_id=sig.instrument_id,
                    bias=sig.bias,
                    status=status,
                    realized_r=result.realized_r,
                    exit_price=result.exit_price,
                    bars_held=result.bars_held,
                    signal_as_of=as_of,
                    evaluated_at=now,
                ))

        await self.db.commit()
        logger.info("Scored signals instrument=%s %s", instrument_id, counts)
        return counts

    async def _price_path_safe(self, instrument_id, start, end) -> list[dict]:
        try:
            return await _price_path(self.db, instrument_id, start, end)
        except Exception:
            logger.warning("price path query failed", exc_info=True)
            return []

    async def get_accuracy(self, instrument_id: int | None = None, lookback_days: int = 90) -> dict:
        """
        Aggregate scorecard: win rate, average R (expectancy), and per-bias
        breakdown over resolved signals in the window.
        """
        since = _utcnow() - timedelta(days=lookback_days)
        stmt = select(SignalOutcome).where(SignalOutcome.signal_as_of >= since)
        if instrument_id is not None:
            stmt = stmt.where(SignalOutcome.instrument_id == instrument_id)
        outcomes = (await self.db.execute(stmt)).scalars().all()

        def summarize(rows: list[SignalOutcome]) -> dict:
            # EXPIRED with no realized_r = no price path → not directionally scorable.
            directional = [
                r for r in rows
                if r.status in (WIN, LOSS) or (r.status == EXPIRED and r.realized_r is not None)
            ]
            wins = [r for r in directional if (r.status == WIN) or (r.realized_r is not None and float(r.realized_r) > 0)]
            rs = [float(r.realized_r) for r in directional if r.realized_r is not None]
            n = len(directional)
            return {
                "resolved": n,
                "wins": len(wins),
                "losses": n - len(wins),
                "win_rate": round(len(wins) / n * 100, 2) if n else None,
                "avg_r": round(sum(rs) / len(rs), 3) if rs else None,
                "open": sum(1 for r in rows if r.status == OPEN),
                "neutral": sum(1 for r in rows if r.status == "NEUTRAL"),
            }

        return {
            "instrument_id": instrument_id,
            "lookback_days": lookback_days,
            "overall": summarize(outcomes),
            "bullish": summarize([o for o in outcomes if o.bias == 1]),
            "bearish": summarize([o for o in outcomes if o.bias == -1]),
            "total_tracked": len(outcomes),
            "as_of": _utcnow(),
        }
