"""
app/ingestion/providers/fyers_provider.py
-----------------------------------------
Live market data from Fyers API v3.
Provides spot prices, option chain, and quotes for
NIFTY 50 and SENSEX.

Symbols used:
    NIFTY 50 spot  : NSE:NIFTY50-INDEX
    SENSEX spot    : BSE:SENSEX-INDEX
    India VIX      : NSE:INDIA VIX-INDEX
    Option chain   : via Fyers option chain API
"""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Tiny TTL cache ────────────────────────────────────────────
# A single dashboard request fans out many get_spot/get_option_chain calls for
# the same instrument (index cards + regime + signal services). Fyers' data API
# is rate-limited, so we cache results briefly to collapse that fan-out into one
# real API hit per instrument and avoid HTTP 429.
_CACHE: dict = {}
_LAST_GOOD: dict = {}  # last successful LIVE result per key (never expires)
_SPOT_TTL = 35.0    # seconds — slightly above the 30s UI poll so polls hit cache
_CHAIN_TTL = 95.0   # seconds — option chain is heavier / changes slower
_VIX_TTL = 120.0    # seconds — VIX is best-effort and market-wide


def _cache_get(key, ttl):
    rec = _CACHE.get(key)
    if rec and (time.time() - rec[0]) < ttl:
        return rec[1]
    return None


def _cache_put(key, value):
    _CACHE[key] = (time.time(), value)


def _serve(key, ttl, fetch):
    """
    Cache-aware fetch:
      1. Return a fresh cached value if within TTL.
      2. Otherwise fetch live; on success cache it and remember it as last-good.
      3. On failure (Fyers error → mock_fallback), prefer the last *live* value
         over mock so the UI never jumps back to a stale mock price.
    """
    cached = _cache_get(key, ttl)
    if cached is not None:
        return cached
    result = fetch()
    if result.get("source") == "fyers":
        _LAST_GOOD[key] = result
        _cache_put(key, result)
        return result
    # Live fetch failed. Prefer the last known live value if we have one.
    if key in _LAST_GOOD:
        stale = dict(_LAST_GOOD[key])
        stale["source"] = "fyers_cached"
        _cache_put(key, stale)
        return stale
    _cache_put(key, result)  # no live value yet — cache mock briefly
    return result

# ─────────────────────────────────────────────────────────────
# FUTURES SYMBOL HELPER
# ─────────────────────────────────────────────────────────────

def _near_month_futures_symbol(instrument_id: int) -> str:
    """
    Return the Fyers near-month futures symbol for NIFTY or SENSEX.
    NIFTY futures expire on the last Thursday of each month.
    If today is past that Thursday, roll to next month.
    """
    from calendar import monthrange
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month

    def last_thursday(y: int, m: int) -> int:
        _, days_in_month = monthrange(y, m)
        for d in range(days_in_month, 0, -1):
            if datetime(y, m, d).weekday() == 3:  # 3 = Thursday
                return d
        return days_in_month

    expiry_day = last_thursday(year, month)
    if now.day > expiry_day:
        # Roll to next month
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1

    month_abbr = datetime(year, month, 1).strftime("%b").upper()  # JUN, JUL …
    yy = str(year)[2:]  # 26

    if instrument_id == 1:
        return f"NSE:NIFTY{yy}{month_abbr}FUT"
    else:
        return f"BSE:SENSEX{yy}{month_abbr}FUT"


# ── Symbol maps ───────────────────────────────────────────────
_SPOT_SYMBOLS = {
    1: "NSE:NIFTY50-INDEX",
    2: "BSE:SENSEX-INDEX",
}

# Fyers' optionchain endpoint takes the underlying INDEX symbol.
_OPTION_SYMBOLS = {
    1: "NSE:NIFTY50-INDEX",
    2: "BSE:SENSEX-INDEX",
}

_SYMBOLS = {
    1: "NIFTY50",
    2: "SENSEX",
}


# ─────────────────────────────────────────────────────────────
# FYERS CLIENT BUILDER
# ─────────────────────────────────────────────────────────────

def _get_fyers():
    """
    Build and return an authenticated Fyers API client.
    Raises RuntimeError if no token is set.
    """
    from app.core.token_store import get_access_token
    from app.core.config import settings
    from fyers_apiv3 import fyersModel

    token = get_access_token()
    if not token:
        raise RuntimeError(
            "Fyers access token not set. "
            "Run the token generation flow first: "
            "GET /api/v1/auth/fyers/login"
        )

    client_id = f"{settings.FYERS_APP_ID}"

    # fyers-apiv3 expects the RAW access token here (NOT "appId:token").
    # Passing "appId:token" produces error -209 "Please provide the
    # validation parameter".
    fyers = fyersModel.FyersModel(
        client_id=client_id,
        token=token,
        log_path="",
        is_async=False,
    )
    return fyers


# ─────────────────────────────────────────────────────────────
# SPOT PRICE
# ─────────────────────────────────────────────────────────────

def get_spot(instrument_id: int) -> dict:
    """Cached wrapper around _fetch_spot to limit Fyers API calls."""
    return _serve(
        ("spot", instrument_id),
        _SPOT_TTL,
        lambda: _fetch_spot(instrument_id),
    )


def _get_vix(fyers) -> Optional[float]:
    """
    Best-effort India VIX. Cached and never raises — a VIX symbol/quota issue
    must never break the index price. Returns None if unavailable.
    """
    cached = _cache_get(("vix",), _VIX_TTL)
    if cached is not None:
        return cached if cached != "none" else None
    vix = None
    try:
        r = fyers.quotes({"symbols": "NSE:INDIAVIX-INDEX"})
        if r.get("code") == 200 and r.get("d"):
            vix = float(r["d"][0]["v"].get("lp", 0)) or None
    except Exception:
        vix = None
    _cache_put(("vix",), vix if vix is not None else "none")
    return vix


def _fetch_spot(instrument_id: int) -> dict:
    """
    Fetch live spot price for NIFTY 50 or SENSEX from Fyers.

    Queries ONLY the index symbol for the price. VIX is fetched separately and
    is best-effort, so a VIX symbol/quota issue can never break the price.
    Falls back to mock data on any error.
    """
    try:
        fyers  = _get_fyers()
        symbol = _SPOT_SYMBOLS.get(instrument_id, "NSE:NIFTY50-INDEX")

        data = fyers.quotes({"symbols": symbol})

        if data.get("code") != 200 or not data.get("d"):
            raise ValueError(f"Fyers quotes error: {data}")

        spot_q = data["d"][0].get("v", {})

        ltp       = float(spot_q.get("lp", 0))
        prev      = float(spot_q.get("prev_close_price", ltp))
        chg_pct   = round((ltp - prev) / prev * 100, 3) if prev else 0.0

        logger.info(
            f"Fyers spot: {_SYMBOLS[instrument_id]} "
            f"LTP={ltp} chg={chg_pct:+.2f}%"
        )

        return {
            "instrument_id": instrument_id,
            "symbol":        _SYMBOLS.get(instrument_id, "UNKNOWN"),
            "last_price":    ltp,
            "open_price":    float(spot_q.get("open_price", 0)) or None,
            "high_price":    float(spot_q.get("high_price", 0)) or None,
            "low_price":     float(spot_q.get("low_price", 0)) or None,
            "prev_close":    prev,
            "change_pct":    chg_pct,
            "volume":        int(spot_q.get("volume", 0)) or None,
            "india_vix":     _get_vix(fyers),
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "source":        "fyers",
        }

    except Exception as e:
        logger.warning(f"Fyers spot failed — falling back to mock: {e}")
        from app.ingestion.providers.mock_provider import get_spot as mock_spot
        result = mock_spot(instrument_id)
        result["source"] = "mock_fallback"
        return result


# ─────────────────────────────────────────────────────────────
# FUTURES
# ─────────────────────────────────────────────────────────────

def get_futures(instrument_id: int) -> dict:
    """Cached wrapper around _fetch_futures."""
    return _serve(
        ("futures", instrument_id),
        _SPOT_TTL,
        lambda: _fetch_futures(instrument_id),
    )


def _fetch_futures(instrument_id: int) -> dict:
    """
    Fetch live near-month futures price + volume for NIFTY or SENSEX.
    Falls back to mock data on any error.
    """
    try:
        fyers  = _get_fyers()
        symbol = _near_month_futures_symbol(instrument_id)

        data = fyers.quotes({"symbols": symbol})

        if data.get("code") != 200 or not data.get("d"):
            raise ValueError(f"Fyers futures error: {data}")

        q = data["d"][0].get("v", {})

        ltp    = float(q.get("lp", 0))
        prev   = float(q.get("prev_close_price", ltp))
        chg    = round(ltp - prev, 2)
        chg_pct = round((ltp - prev) / prev * 100, 3) if prev else 0.0
        volume = int(q.get("volume", 0) or 0)

        logger.info(
            f"Fyers futures: {_SYMBOLS[instrument_id]} "
            f"symbol={symbol} LTP={ltp} vol={volume}"
        )

        return {
            "instrument_id": instrument_id,
            "symbol":        _SYMBOLS.get(instrument_id, "UNKNOWN"),
            "futures_symbol": symbol,
            "last_price":    ltp,
            "prev_close":    prev,
            "change":        chg,
            "change_pct":    chg_pct,
            "volume":        volume,
            "open_price":    float(q.get("open_price", 0)) or None,
            "high_price":    float(q.get("high_price", 0)) or None,
            "low_price":     float(q.get("low_price", 0)) or None,
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "source":        "fyers",
        }

    except Exception as e:
        logger.warning(f"Fyers futures failed — falling back to mock: {e}")
        return {
            "instrument_id": instrument_id,
            "symbol":        _SYMBOLS.get(instrument_id, "UNKNOWN"),
            "futures_symbol": _near_month_futures_symbol(instrument_id),
            "last_price":    0.0,
            "prev_close":    0.0,
            "change":        0.0,
            "change_pct":    0.0,
            "volume":        0,
            "open_price":    None,
            "high_price":    None,
            "low_price":     None,
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "source":        "mock_fallback",
        }


# ─────────────────────────────────────────────────────────────
# OPTION CHAIN
# ─────────────────────────────────────────────────────────────

def get_option_chain(
    instrument_id: int,
    expiry_date: Optional[str] = None,
) -> dict:
    """Cached wrapper around _fetch_option_chain to limit Fyers API calls."""
    return _serve(
        ("chain", instrument_id, expiry_date),
        _CHAIN_TTL,
        lambda: _fetch_option_chain(instrument_id, expiry_date),
    )


def _fetch_option_chain(
    instrument_id: int,
    expiry_date: Optional[str] = None,
) -> dict:
    """
    Fetch live option chain for NIFTY 50 or SENSEX from Fyers.
    Falls back to mock data on any error.

    Fyers option chain endpoint returns CE + PE rows with
    OI, LTP, IV, greeks for each strike.
    """
    try:
        fyers  = _get_fyers()
        symbol = _OPTION_SYMBOLS.get(instrument_id, "NSE:NIFTY50")

        # Get option chain
        payload = {"symbol": symbol, "strikecount": 20}
        if expiry_date:
            payload["timestamp"] = expiry_date

        data = fyers.optionchain(payload)

        if data.get("code") != 200 or not data.get("data"):
            raise ValueError(f"Fyers option chain error: {data}")

        chain_data = data["data"]
        options    = chain_data.get("optionsChain", []) or []

        # Expiry: Fyers returns a list of expiries; pick the nearest.
        expiry_list = chain_data.get("expiryData", []) or []
        if expiry_list:
            expiry = _normalize_expiry(
                expiry_list[0].get("expiry") or expiry_list[0].get("date"),
                expiry_date,
            )
        else:
            expiry = _normalize_expiry(None, expiry_date)

        # Fyers' optionsChain is a FLAT list: each entry is one CE or PE.
        # The underlying carries strike_price == -1 (its ltp is the spot).
        rows = []
        total_call = 0
        total_put  = 0
        spot = 0.0

        for opt in options:
            otype  = opt.get("option_type", "")
            strike = float(opt.get("strike_price", 0) or 0)

            if otype not in ("CE", "PE") or strike < 0:
                spot = float(opt.get("ltp", 0) or 0) or spot
                continue

            oi = int(opt.get("oi", 0) or 0)
            rows.append({
                "strike":      strike,
                "option_type": otype,
                "ltp":         float(opt.get("ltp", 0) or 0),
                "oi":          oi,
                "oi_change":   int(opt.get("oich", 0) or 0),
                "volume":      int(opt.get("volume", 0) or 0),
                "iv":          float(opt.get("iv", 0) or 0),
                "delta":       0.0,
                "theta":       0.0,
                "vega":        0.0,
                "gamma":       0.0,
            })
            if otype == "CE":
                total_call += oi
            else:
                total_put += oi

        pcr = round(total_put / total_call, 4) if total_call else 1.0

        logger.info(
            f"Fyers chain: {_SYMBOLS[instrument_id]} "
            f"{len(rows)} rows PCR={pcr}"
        )

        return {
            "instrument_id": instrument_id,
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "expiry_date":   expiry,
            "spot":          spot,
            "atm_strike":    _nearest_atm(spot, rows),
            "total_call_oi": total_call,
            "total_put_oi":  total_put,
            "pcr_oi":        pcr,
            "rows":          rows,
            "source":        "fyers",
        }

    except Exception as e:
        logger.warning(f"Fyers chain failed — falling back to mock: {e}")
        from app.ingestion.providers.mock_provider import (
            get_option_chain as mock_chain,
        )
        # Don't pass None — mock would echo expiry_date=None and break
        # downstream date parsing. Let mock use its own default expiry.
        result = (
            mock_chain(instrument_id)
            if expiry_date is None
            else mock_chain(instrument_id, expiry_date)
        )
        result["source"] = "mock_fallback"
        return result


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _nearest_atm(spot: float, rows: list[dict]) -> float:
    """Find the nearest strike to spot from chain rows."""
    strikes = list({r["strike"] for r in rows})
    if not strikes:
        return round(spot / 50) * 50
    return min(strikes, key=lambda s: abs(s - spot))


def _normalize_expiry(raw, fallback: Optional[str]) -> str:
    """
    Return expiry as 'YYYY-MM-DD'. Fyers returns expiryDate as an epoch
    seconds string; we also tolerate already-formatted dates. Never returns
    None — downstream code parses this with strptime.
    """
    # Epoch seconds (Fyers' usual format)
    if raw is not None:
        try:
            ts = int(str(raw).strip())
            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        except (ValueError, TypeError, OSError):
            pass
        s = str(raw).strip()
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d-%b-%Y"):
            try:
                return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    if fallback:
        return fallback
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def is_connected() -> bool:
    """Quick health check — returns True if Fyers token is set."""
    try:
        fyers  = _get_fyers()
        result = fyers.get_profile()
        return result.get("code") == 200
    except Exception:
        return False