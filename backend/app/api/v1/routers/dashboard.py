"""
api/v1/routers/dashboard.py
----------------------------
GET /api/v1/dashboard
One-shot composite snapshot — all modules in one response.
"""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.deps import DBSession, CurrentUserId
from app.engines.options_math import (
    ChainRow, atm_strike, classify_buildup, max_pain,
    oi_walls, pcr_oi, writing_posture,
)
from app.ingestion.providers import get_option_chain, get_spot
from app.services.regime_service import RegimeService
from app.services.signal_service import SignalService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DISCLAIMER = (
    "All outputs are AI-generated market intelligence "
    "for informational purposes only. NOT investment advice. "
    "AI usage disclosed per SEBI guidelines. "
    "Consult a SEBI-registered adviser before trading."
)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _is_market_hours() -> bool:
    """Check if current IST time is within market hours 09:00–15:45."""
    from datetime import time, timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist).time()
    return time(9, 0) <= now <= time(15, 45)


_BUILDUP_HUMAN = {
    "LONG_BUILDUP":   "Long Build-up",
    "SHORT_BUILDUP":  "Short Build-up",
    "SHORT_COVERING": "Short Covering",
    "LONG_UNWINDING": "Long Unwinding",
}


def _build_index_card(instrument_id: int) -> dict:
    """
    Builds a single index summary card + classified option chain rows.
    Runs synchronously — wrapped in asyncio.to_thread by caller.
    """
    spot_data  = get_spot(instrument_id)
    spot       = spot_data["last_price"]
    change_pct = spot_data.get("change_pct", 0.0) or 0.0

    chain_data = get_option_chain(instrument_id)
    raw_rows   = chain_data["rows"]

    engine_rows = [
        ChainRow(
            strike=r["strike"],
            opt_type=r["option_type"],
            oi=r.get("oi", 0) or 0,
            oi_change=r.get("oi_change", 0) or 0,
            ltp=r.get("ltp", 0.0) or 0.0,
            volume=r.get("volume", 0) or 0,
            price_change=change_pct,
            iv=r.get("iv"),
        )
        for r in raw_rows
    ]

    strikes  = sorted({r.strike for r in engine_rows})
    walls    = oi_walls(engine_rows, spot)
    pcr      = pcr_oi(engine_rows)
    atm      = atm_strike(spot, strikes)
    mp       = max_pain(engine_rows, strikes) if strikes else atm
    posture  = writing_posture(engine_rows)

    direction = (
        "UP"   if change_pct >  0.10 else
        "DOWN" if change_pct < -0.10 else
        "FLAT"
    )

    # Build classified chain rows in the shape OptionChainTable expects:
    #   type (not option_type), buildup (humanised, not buildup_label)
    chain_rows = []
    for r in raw_rows:
        _, label = classify_buildup(change_pct, r.get("oi_change", 0) or 0)
        chain_rows.append({
            "strike":     r["strike"],
            "type":       r["option_type"],   # CE | PE
            "oi":         r.get("oi"),
            "oi_change":  r.get("oi_change"),
            "ltp":        r.get("ltp"),
            "iv":         r.get("iv"),
            "volume":     r.get("volume"),
            "buildup":    _BUILDUP_HUMAN.get(label, label),
        })

    options_metrics = {
        "pcr_oi":          pcr,
        "max_pain":        mp,
        "support":         walls.get("support"),
        "resistance":      walls.get("resistance"),
        "writing_posture": posture,
    }

    return {
        "symbol":          spot_data["symbol"],
        "last_price":      spot,
        "change_pct":      change_pct,
        "direction":       direction,
        "india_vix":       spot_data.get("india_vix"),
        "atm_strike":      atm,
        "support":         walls.get("support"),
        "resistance":      walls.get("resistance"),
        "pcr_oi":          pcr,
        # extra fields consumed by dashboard aggregate
        "_chain_rows":     chain_rows,
        "_options":        options_metrics,
        "_atm_strike":     atm,
    }


def _build_ai_summary(
    nifty: dict,
    sensex: dict,
    nifty_regime: dict,
    nifty_signal: dict,
    sensex_regime: dict,
    sensex_signal: dict,
) -> str:
    """
    Builds a plain-English AI summary paragraph from computed values.
    In production this becomes a cached LLM call.
    """
    nr  = nifty_regime
    ns  = nifty_signal
    sr  = sensex_regime
    ss  = sensex_signal
    vix = nifty.get("india_vix", 0) or 0

    vix_comment = (
        "VIX elevated — exercise caution with position sizing."
        if vix > 18 else
        "VIX within normal range."
    )

    return (
        f"NIFTY is in a **{nr['regime_label']}** regime "
        f"({nr['confidence']:.0%} confidence) with a "
        f"**{ns['bias_label']}** AI bias ({ns['confidence']:.0%}). "
        f"SENSEX mirrors with **{sr['regime_label']}** / "
        f"**{ss['bias_label']}**. "
        f"India VIX at {vix:.1f} — {vix_comment} "
        f"PCR at {nifty.get('pcr_oi', 0):.2f}. "
        f"Support {nifty.get('support')} | "
        f"Resistance {nifty.get('resistance')}."
    )


# ─────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────

@router.get("")
async def dashboard(
    db: DBSession,
    _uid: CurrentUserId,
):
    """
    One-shot composite intelligence snapshot.
    Fetches NIFTY + SENSEX data concurrently for speed.
    """
    now = datetime.now(timezone.utc)

    # Index cards are pure compute (no DB) — safe to run concurrently.
    nifty, sensex = await asyncio.gather(
        asyncio.to_thread(_build_index_card, 1),
        asyncio.to_thread(_build_index_card, 2),
    )

    # Regime and signal services share a single AsyncSession, which cannot be
    # used by multiple coroutines at once. Run these DB calls sequentially.
    regime_svc = RegimeService(db)
    signal_svc = SignalService(db)

    nifty_regime  = await regime_svc.get_current_regime(1)
    sensex_regime = await regime_svc.get_current_regime(2)
    nifty_signal  = await signal_svc.get_latest_signal(1)
    sensex_signal = await signal_svc.get_latest_signal(2)

    # Serialise Pydantic models to dicts for summary builder
    nr_dict = nifty_regime.model_dump()
    ns_dict = nifty_signal.model_dump()
    sr_dict = sensex_regime.model_dump()
    ss_dict = sensex_signal.model_dump()

    ai_summary = _build_ai_summary(
        nifty, sensex,
        nr_dict, ns_dict,
        sr_dict, ss_dict,
    )

    # Extract chain / options from index cards then strip private keys
    nifty_chain   = nifty.pop("_chain_rows", [])
    nifty_options = nifty.pop("_options", {})
    nifty.pop("_atm_strike", None)
    sensex.pop("_chain_rows", None)
    sensex.pop("_options", None)
    sensex.pop("_atm_strike", None)

    return {
        "as_of":         now.isoformat(),
        "market_hours":  _is_market_hours(),
        "nifty":         nifty,
        "sensex":        sensex,
        "nifty_regime":  nr_dict,
        "sensex_regime": sr_dict,
        "nifty_signal":  ns_dict,
        "sensex_signal": ss_dict,
        "ai_summary":    ai_summary,
        "option_chain":  nifty_chain,
        "options":       nifty_options,
        "disclaimer":    DISCLAIMER,
    }