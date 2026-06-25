"""
api/v1/routers/signals.py
--------------------------
GET /api/v1/signals/{instrument_id}/latest
"""
from fastapi import APIRouter, Path, Query

from app.core.deps import CurrentUserId, DBSession
from app.domain.schemas import AISignalOut
from app.services.signal_service import SignalService
from app.services.signal_outcome_service import SignalOutcomeService

router = APIRouter(prefix="/signals", tags=["signals"])


@router.get(
    "/{instrument_id}/latest",
    response_model=AISignalOut,
)
async def latest_signal(
    instrument_id: int = Path(..., ge=1, le=2),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    AI-synthesized intelligence signal.

    Fuses:
        Market regime (weight 3.0)
        OI build-up + writing posture (weight 2.5)
        Smart money signals (weight 2.0)
        FII/DII flow (weight 1.5)
        News sentiment (weight 1.0)

    Returns:
        bias         — Bullish / Neutral / Bearish
        confidence   — 0 to 1
        entry_ref    — illustrative entry level (NOT advice)
        stop_ref     — illustrative stop level  (NOT advice)
        target_ref   — illustrative target      (NOT advice)
        risk_reward  — illustrative R:R ratio   (NOT advice)
        reasoning    — plain-English explanation
        disclaimer   — mandatory SEBI disclosure

    COMPLIANCE NOTE:
        This output is Lane A intelligence mode.
        disclosure_mode = "intelligence"
        These are NOT buy/sell recommendations.
        NOT investment advice.
        Consult a SEBI-registered adviser before trading.
    """
    svc = SignalService(db)
    return await svc.get_latest_signal(instrument_id)


@router.get("/{instrument_id}/accuracy")
async def signal_accuracy(
    instrument_id: int = Path(..., ge=1, le=2),
    lookback_days: int = Query(90, ge=1, le=365),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    Historical accuracy scorecard for this instrument's AI signals:
    win rate, average realised R (expectancy), and bullish/bearish breakdown
    over `lookback_days`. Outcomes are scored by the background job; call
    POST /score to force a fresh evaluation.
    """
    return await SignalOutcomeService(db).get_accuracy(instrument_id, lookback_days)


@router.post("/{instrument_id}/score")
async def score_signals(
    instrument_id: int = Path(..., ge=1, le=2),
    lookback_days: int = Query(30, ge=1, le=180),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """Force-evaluate pending signals for this instrument against actual price."""
    return await SignalOutcomeService(db).score_pending(instrument_id, lookback_days)