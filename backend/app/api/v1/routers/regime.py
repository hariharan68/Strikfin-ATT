"""
api/v1/routers/regime.py
-------------------------
GET /api/v1/regime/{instrument_id}
"""
from fastapi import APIRouter, Path

from app.core.deps import CurrentUserId, DBSession
from app.domain.schemas import RegimeRead
from app.services.regime_service import RegimeService

router = APIRouter(prefix="/regime", tags=["regime"])


@router.get(
    "/{instrument_id}",
    response_model=RegimeRead,
)
async def get_regime(
    instrument_id: int = Path(..., ge=1, le=2),
    db: DBSession = None,
    _uid: CurrentUserId = None,
):
    """
    Current 7-state market regime classification.

    States:
        1  Trend Up       — sustained upward move with strength
        2  Trend Down     — sustained downward move with strength
        3  Sideways       — range-bound, low directional momentum
        4  Breakout       — price breaking compressed range with OI
        5  Reversal       — momentum turning, OI unwinding
        6  High Volatility — VIX spike or range expansion
        7  Low Volatility  — compressed, calm, pre-event often

    Response includes:
        regime code + label
        confidence (0–1)
        top_features — evidence dict explaining the classification
        model_version — for audit trail
    """
    svc = RegimeService(db)
    return await svc.get_current_regime(instrument_id)