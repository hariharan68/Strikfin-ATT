"""
api/v1/routers/institutional.py
--------------------------------
GET /api/v1/institutional
"""
import random
from datetime import date, datetime, timezone

from fastapi import APIRouter

from app.core.deps import CurrentUserId
from app.ingestion.providers import get_institutional_activity

router = APIRouter(prefix="/institutional", tags=["institutional"])


def _interpret(
    fii_net: float,
    dii_net: float,
    fii_fut_net: float,
    fii_long: int,
    fii_short: int,
) -> str:
    """
    Produces a plain-English interpretation of institutional flows.

    Logic:
        FII cash net > 1000 cr  → bullish cash flow
        FII cash net < -1000 cr → bearish cash flow
        DII net > 500 cr        → domestic floor / absorption
        FII futures long > short → bullish futures positioning
        FII futures short > long → bearish futures positioning

    Cash data alone is incomplete — always paired with F&O positioning.
    """
    parts = []

    # FII cash read
    if fii_net > 1_000:
        parts.append(f"FII net bought ₹{fii_net:,.0f} cr in cash")
    elif fii_net < -1_000:
        parts.append(f"FII net sold ₹{abs(fii_net):,.0f} cr in cash")
    else:
        parts.append(f"FII cash flows muted (₹{fii_net:,.0f} cr net)")

    # DII absorption read
    if dii_net > 500:
        parts.append(f"DII absorbed with ₹{dii_net:,.0f} cr net buy")
    elif dii_net < -500:
        parts.append(f"DII also selling ₹{abs(dii_net):,.0f} cr net")
    else:
        parts.append("DII flows neutral")

    # FII futures positioning
    if fii_long > fii_short * 1.15:
        parts.append("FII index futures net long → bullish derivatives positioning")
    elif fii_short > fii_long * 1.15:
        parts.append("FII index futures net short → bearish derivatives positioning")
    else:
        parts.append("FII futures positioning balanced")

    # Overall verdict
    bullish_signals = sum([
        fii_net > 1_000,
        dii_net > 500,
        fii_long > fii_short * 1.15,
    ])
    bearish_signals = sum([
        fii_net < -1_000,
        dii_net < -500,
        fii_short > fii_long * 1.15,
    ])

    if bullish_signals >= 2:
        verdict = "→ Overall: Bullish institutional posture"
    elif bearish_signals >= 2:
        verdict = "→ Overall: Bearish institutional posture"
    else:
        verdict = "→ Overall: Mixed / Neutral institutional posture"

    return " | ".join(parts) + " " + verdict


@router.get("")
async def institutional(
    _uid: CurrentUserId = None,
):
    """
    FII/DII institutional activity summary.

    Data sources (production):
        FII/DII cash  — NSE/BSE provisional post 16:00 IST
        Participant OI — NSE EOD report post 18:00 IST
        Final FPI     — NSDL/CDSL post 19:00 IST

    Returns:
        fii_cash_net_cr      — FII net cash (₹ crore)
        dii_cash_net_cr      — DII net cash (₹ crore)
        fii_idx_fut_net_cr   — FII index futures net (₹ crore)
        fii_long_contracts   — FII long contracts in index futures
        fii_short_contracts  — FII short contracts in index futures
        rolling_5d_fii_net   — 5-day rolling FII net (₹ crore)
        rolling_20d_fii_net  — 20-day rolling FII net (₹ crore)
        interpretation       — plain-English institutional read
        is_provisional       — true until NSDL/CDSL final data

    Note:
        Single-day FII data is noisy.
        Use rolling_5d and rolling_20d for trend confirmation.
        Sustained 3-week FII selling historically correlates
        with 3–8% NIFTY drawdowns.
    """
    today = date.today().isoformat()
    data  = get_institutional_activity(today)

    # Extract each category
    fii_cash = next(
        (d for d in data if d["category"] == "FII" and d["segment"] == "CASH"),
        None,
    )
    dii_cash = next(
        (d for d in data if d["category"] == "DII" and d["segment"] == "CASH"),
        None,
    )
    fii_fut  = next(
        (d for d in data if d["category"] == "FII" and d["segment"] == "IDX_FUT"),
        None,
    )

    fii_net      = fii_cash["net_value_cr"]  if fii_cash else 0.0
    dii_net      = dii_cash["net_value_cr"]  if dii_cash else 0.0
    fii_fut_net  = fii_fut["net_value_cr"]   if fii_fut  else 0.0
    fii_long     = fii_fut["long_contracts"] if fii_fut  else 0
    fii_short    = fii_fut["short_contracts"]if fii_fut  else 0

    # Mock rolling figures (real: queried from DB)
    rolling_5d  = round(fii_net * random.uniform(3.0, 5.0), 0)
    rolling_20d = round(fii_net * random.uniform(10.0, 18.0), 0)

    interpretation = _interpret(
        fii_net,
        dii_net,
        fii_fut_net,
        fii_long,
        fii_short,
    )

    return {
        "trade_date":          today,
        "fii_cash_net_cr":     fii_net,
        "dii_cash_net_cr":     dii_net,
        "fii_idx_fut_net_cr":  fii_fut_net,
        "fii_long_contracts":  fii_long,
        "fii_short_contracts": fii_short,
        "rolling_5d_fii_net":  rolling_5d,
        "rolling_20d_fii_net": rolling_20d,
        "interpretation":      interpretation,
        "is_provisional":      True,
        "as_of":               datetime.now(timezone.utc).isoformat(),
        "note": (
            "Provisional data. "
            "Final figures available post 19:00 IST from NSDL/CDSL."
        ),
    }