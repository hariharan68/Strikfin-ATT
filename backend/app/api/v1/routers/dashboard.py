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
from app.instruments import snapshot as instrument_snapshot
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
    atm      = atm_strike(spot, strikes, instrument_snapshot.strike_step(instrument_id))
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
        opt_type = r.get("option_type", "CE")
        effective_chg = change_pct if opt_type == "CE" else -change_pct
        _, label = classify_buildup(effective_chg, r.get("oi_change", 0) or 0)
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


def _build_ai_summary(entries: list[dict], by_id: dict[int, dict]) -> str:
    """Generic AI blurb over whatever instruments are configured. The primary
    instrument (id 1 / NIFTY if present, else the first) anchors VIX/PCR/levels;
    the rest contribute their bias. Reduces to the old NIFTY+SENSEX text for the
    default two-instrument setup."""
    primary = by_id.get(1) or (entries[0] if entries else None)
    if not primary:
        return "No instruments configured."

    card = primary["card"]
    sig = primary["signal"]
    vix = card.get("india_vix", 0) or 0
    vix_comment = (
        "VIX elevated — exercise caution with position sizing."
        if vix > 18 else "VIX within normal range."
    )

    parts = [
        f"{primary['label']} AI bias: **{sig['bias_label']}** "
        f"({sig['confidence']:.0%} confidence)."
    ]
    for e in entries:
        if e["instrument_id"] == primary["instrument_id"]:
            continue
        parts.append(f"{e['label']} AI bias: **{e['signal']['bias_label']}**.")
    parts.append(f"India VIX at {vix:.1f} — {vix_comment}")
    parts.append(
        f"PCR at {card.get('pcr_oi', 0):.2f}. "
        f"Support {card.get('support')} | Resistance {card.get('resistance')}."
    )
    return " ".join(parts)


# ─────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────

# Legacy response key prefixes for the built-in indices — kept so the current
# (pre-M4) frontend, which reads data.nifty / data.sensex_signal / …, keeps
# working. The generic `instruments` list is the forward shape; drop this shim
# once the frontend consumes it (M4).
_LEGACY_KEYS = {1: "nifty", 2: "sensex"}


@router.get("")
async def dashboard(
    db: DBSession,
    _uid: CurrentUserId,
):
    """
    One-shot composite intelligence snapshot across ALL active instruments.

    Returns a generic `instruments` list; also emits legacy `nifty_*`/`sensex_*`
    keys for back-compat until the frontend is generalized (M4).
    """
    now = datetime.now(timezone.utc)
    refs = instrument_snapshot.all_active()

    # Index cards are pure compute (no DB) — build them all concurrently.
    cards = await asyncio.gather(
        *[asyncio.to_thread(_build_index_card, r.instrument_id) for r in refs]
    )

    signal_svc = SignalService(db)

    entries: list[dict] = []
    by_id: dict[int, dict] = {}
    for ref, card in zip(refs, cards):
        chain = card.pop("_chain_rows", [])
        options = card.pop("_options", {})
        card.pop("_atm_strike", None)
        signal = (await signal_svc.get_latest_signal(ref.instrument_id)).model_dump()
        entry = {
            "instrument_id": ref.instrument_id,
            "symbol":        ref.symbol,
            "label":         ref.label,
            "card":          card,
            "signal":        signal,
            "option_chain":  chain,
            "options":       options,
        }
        entries.append(entry)
        by_id[ref.instrument_id] = entry

    ai_summary = _build_ai_summary(entries, by_id)

    resp: dict = {
        "as_of":        now.isoformat(),
        "market_hours": _is_market_hours(),
        "instruments":  entries,          # ← generic forward shape
        "ai_summary":   ai_summary,
        "disclaimer":   DISCLAIMER,
    }

    # ── Back-compat shim (legacy nifty_*/sensex_* keys) ──────────────────────
    for iid, name in _LEGACY_KEYS.items():
        e = by_id.get(iid)
        if not e:
            continue
        resp[name] = e["card"]
        resp[f"{name}_signal"] = e["signal"]
        resp[f"{name}_option_chain"] = e["option_chain"]
        resp[f"{name}_options"] = e["options"]

    primary = by_id.get(1)
    if primary:  # legacy NIFTY-default fields
        resp["option_chain"] = primary["option_chain"]
        resp["options"] = primary["options"]

    return resp
