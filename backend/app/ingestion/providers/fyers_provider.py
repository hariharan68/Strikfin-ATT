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
import math
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from app.engines.options_math import implied_vol, greeks

logger = logging.getLogger(__name__)

# ── Tiny TTL cache ────────────────────────────────────────────
# A single dashboard request fans out many get_spot/get_option_chain calls for
# the same instrument (index cards + regime + signal services). Fyers' data API
# is rate-limited, so we cache results briefly to collapse that fan-out into one
# real API hit per instrument and avoid HTTP 429.
_CACHE: dict = {}
_LAST_GOOD: dict = {}  # last successful LIVE result per key (never expires)
# Serialises the batched spot refresh: the dashboard builds NIFTY + SENSEX
# cards in parallel threads, so without this both would miss the cache and each
# fire the "batched" quotes() call — defeating the batching. One thread fetches;
# the other waits and reads the freshly-populated cache.
_spot_refresh_lock = threading.Lock()
_SPOT_TTL = 35.0    # seconds — slightly above the 30s UI poll so polls hit cache
_CHAIN_TTL = 95.0   # seconds — option chain is heavier / changes slower


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

# All instruments whose spot is refreshed together in one quotes() call.
_ALL_INSTRUMENTS = (1, 2)
_VIX_SYMBOL = "NSE:INDIAVIX-INDEX"

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
    """
    Live spot for NIFTY 50 / SENSEX, served from the short-TTL cache.

    On a cache miss, ONE batched quotes() call refreshes every instrument's
    spot AND India VIX together (see _refresh_all_spots). Fetching each symbol
    separately made the dashboard fire NIFTY-spot + SENSEX-spot + VIX as three
    near-simultaneous requests, which tripped Fyers' burst rate limit (HTTP
    429) and silently dropped the whole app onto mock prices. Batching collapses
    that into a single hit, so the real index price is what actually shows.
    """
    cached = _cache_get(("spot", instrument_id), _SPOT_TTL)
    if cached is not None:
        return cached

    with _spot_refresh_lock:
        # A parallel thread may have refreshed while we waited for the lock.
        cached = _cache_get(("spot", instrument_id), _SPOT_TTL)
        if cached is not None:
            return cached
        _refresh_all_spots()

    cached = _cache_get(("spot", instrument_id), _SPOT_TTL)
    return cached if cached is not None else _mock_spot(instrument_id)


def _mock_spot(instrument_id: int) -> dict:
    """Mock spot, tagged so history ingestion never persists it as real data."""
    from app.ingestion.providers.mock_provider import get_spot as mock_spot
    result = mock_spot(instrument_id)
    result["source"] = "mock_fallback"
    return result


def _refresh_all_spots() -> None:
    """
    Refresh every instrument's spot + India VIX + current-month FUTURES in a
    SINGLE quotes() call, then populate the cache (and last-good store) for each.

    Futures rides along in the same batched request so the tradable FUT price
    (used by Options Lab price overlays) is captured without a separate call —
    the same anti-429 batching the spot fix relies on. get_futures() reads the
    ("futures", id) cache this fills, so it costs no extra Fyers hit on the hot
    path (dashboard/persist call get_spot first, which triggers this refresh).

    Best-effort and never raises: on a live failure each instrument degrades to
    its last known LIVE value (so the price never jumps back to a stale mock),
    or to mock only if we have never had a live value.
    """
    live: dict[int, dict] = {}
    futs: dict[int, dict] = {}
    vix: Optional[float] = None
    now_iso = datetime.now(timezone.utc).isoformat()
    fut_symbols = {i: _near_month_futures_symbol(i) for i in _ALL_INSTRUMENTS}

    try:
        fyers   = _get_fyers()
        symbols = ",".join(
            [_SPOT_SYMBOLS[i] for i in _ALL_INSTRUMENTS]
            + [_VIX_SYMBOL]
            + [fut_symbols[i] for i in _ALL_INSTRUMENTS]
        )
        data = fyers.quotes({"symbols": symbols})

        if data.get("code") != 200 or not data.get("d"):
            raise ValueError(f"Fyers quotes error: {data}")

        by_symbol = {d.get("n"): d.get("v", {}) for d in data["d"]}

        vq = by_symbol.get(_VIX_SYMBOL, {})
        vix = float(vq.get("lp", 0) or 0) or None

        for iid in _ALL_INSTRUMENTS:
            q = by_symbol.get(_SPOT_SYMBOLS[iid])
            if q:
                ltp     = float(q.get("lp", 0))
                prev    = float(q.get("prev_close_price", ltp) or ltp)
                chg_pct = round((ltp - prev) / prev * 100, 3) if prev else 0.0
                live[iid] = {
                    "instrument_id": iid,
                    "symbol":        _SYMBOLS.get(iid, "UNKNOWN"),
                    "last_price":    ltp,
                    "open_price":    float(q.get("open_price", 0)) or None,
                    "high_price":    float(q.get("high_price", 0)) or None,
                    "low_price":     float(q.get("low_price", 0)) or None,
                    "prev_close":    prev,
                    "change_pct":    chg_pct,
                    "volume":        int(q.get("volume", 0)) or None,
                    "india_vix":     vix,
                    "snap_ts":       now_iso,
                    "source":        "fyers",
                }

            fq = by_symbol.get(fut_symbols[iid])
            if fq and float(fq.get("lp", 0) or 0) > 0:
                fltp = float(fq.get("lp", 0))
                fprev = float(fq.get("prev_close_price", fltp) or fltp)
                futs[iid] = {
                    "instrument_id":  iid,
                    "symbol":         _SYMBOLS.get(iid, "UNKNOWN"),
                    "futures_symbol": fut_symbols[iid],
                    "last_price":     fltp,
                    "prev_close":     fprev,
                    "change":         round(fltp - fprev, 2),
                    "change_pct":     round((fltp - fprev) / fprev * 100, 3) if fprev else 0.0,
                    "volume":         int(fq.get("volume", 0) or 0),
                    "open_price":     float(fq.get("open_price", 0)) or None,
                    "high_price":     float(fq.get("high_price", 0)) or None,
                    "low_price":      float(fq.get("low_price", 0)) or None,
                    "snap_ts":        now_iso,
                    "source":         "fyers",
                }

        logger.info(
            "Fyers batched spot: %s VIX=%s FUT=%s",
            {_SYMBOLS[i]: live[i]["last_price"] for i in live},
            vix,
            {_SYMBOLS[i]: futs[i]["last_price"] for i in futs},
        )

    except Exception as e:
        logger.warning(f"Fyers batched spot failed — using last-good/mock: {e}")

    for iid in _ALL_INSTRUMENTS:
        if iid in live:
            _LAST_GOOD[("spot", iid)] = live[iid]
            _cache_put(("spot", iid), live[iid])
        elif ("spot", iid) in _LAST_GOOD:
            stale = dict(_LAST_GOOD[("spot", iid)])
            stale["source"] = "fyers_cached"
            if vix is not None:  # a fresh VIX is still worth surfacing
                stale["india_vix"] = vix
            _cache_put(("spot", iid), stale)
        else:
            _cache_put(("spot", iid), _mock_spot(iid))

        # Pre-fill the futures cache so get_futures() hits it (no extra call).
        # Only cache real values — never mock — so the snapshot's future_price
        # stays NULL (→ spot fallback) rather than storing a fake futures price.
        if iid in futs:
            _LAST_GOOD[("futures", iid)] = futs[iid]
            _cache_put(("futures", iid), futs[iid])
        elif ("futures", iid) in _LAST_GOOD:
            stale_f = dict(_LAST_GOOD[("futures", iid)])
            stale_f["source"] = "fyers_cached"
            _cache_put(("futures", iid), stale_f)


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
# HISTORICAL CANDLES  (for ATR / ADX / realized vol)
# ─────────────────────────────────────────────────────────────

_HISTORY_TTL = 3600.0  # daily candles change once/day — cache an hour


def get_history(instrument_id: int, days: int = 60, resolution: str = "D") -> dict:
    """Cached wrapper around _fetch_history (daily OHLC by default)."""
    return _serve(
        ("history", instrument_id, days, resolution),
        _HISTORY_TTL,
        lambda: _fetch_history(instrument_id, days, resolution),
    )


def _fetch_history(instrument_id: int, days: int, resolution: str) -> dict:
    """
    Fetch historical OHLC candles for NIFTY/SENSEX from Fyers' history API.
    Returns {"candles": [{ts, open, high, low, close, volume}, ...]} oldest→newest.
    Falls back to mock candles on any error so ATR/ADX always have *something*
    (callers still treat a short/None series as "no real data").
    """
    from datetime import timedelta
    try:
        fyers  = _get_fyers()
        symbol = _SPOT_SYMBOLS.get(instrument_id, "NSE:NIFTY50-INDEX")
        now    = datetime.now(timezone.utc)
        payload = {
            "symbol":      symbol,
            "resolution":  resolution,
            "date_format": "1",
            "range_from":  (now - timedelta(days=days)).strftime("%Y-%m-%d"),
            "range_to":    now.strftime("%Y-%m-%d"),
            "cont_flag":   "1",
        }
        data = fyers.history(payload)
        if data.get("code") != 200 or not data.get("candles"):
            raise ValueError(f"Fyers history error: {data}")

        candles = [
            {
                "ts":     int(c[0]),
                "open":   float(c[1]),
                "high":   float(c[2]),
                "low":    float(c[3]),
                "close":  float(c[4]),
                "volume": int(c[5]) if len(c) > 5 else 0,
            }
            for c in data["candles"]
        ]
        logger.info(f"Fyers history: {_SYMBOLS[instrument_id]} {len(candles)} {resolution} candles")
        return {"instrument_id": instrument_id, "candles": candles, "source": "fyers"}

    except Exception as e:
        logger.warning(f"Fyers history failed — falling back to mock: {e}")
        from app.ingestion.providers.mock_provider import get_history as mock_history
        result = mock_history(instrument_id, days, resolution)
        result["source"] = "mock_fallback"
        return result


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

        # Time-to-expiry in years for the IV solver. Fyers' `expiry` is the
        # unix timestamp of the exact expiry instant (15:30 IST).
        t_years = 0.0
        if expiry_list:
            try:
                exp_ts  = int(expiry_list[0].get("expiry"))
                t_years = max(exp_ts - time.time(), 0.0) / (365.0 * 86400.0)
            except (TypeError, ValueError):
                t_years = 0.0

        # Fyers' optionsChain is a FLAT list: each entry is one CE or PE.
        # The underlying carries strike_price == -1 (its ltp is the spot).
        # First pass: collect raw legs + spot; IV needs the forward, which is
        # derived from the collected legs below.
        raw_legs: list[dict] = []
        spot = 0.0
        fp = 0.0

        for opt in options:
            otype  = opt.get("option_type", "")
            strike = float(opt.get("strike_price", 0) or 0)

            if otype not in ("CE", "PE") or strike < 0:
                spot = float(opt.get("ltp", 0) or 0) or spot
                fp   = float(opt.get("fp", 0) or 0) or fp
                continue

            raw_legs.append({
                "strike":      strike,
                "option_type": otype,
                "ltp":         float(opt.get("ltp", 0) or 0),
                "oi":          int(opt.get("oi", 0) or 0),
                "oi_change":   int(opt.get("oich", 0) or 0),
                "volume":      int(opt.get("volume", 0) or 0),
            })

        # Forward for Black-76 on THIS expiry. Put-call parity at the strike
        # nearest spot (F = K + (C − P)/disc) is exact for the chain's own
        # expiry. Fyers' `fp` is the near-MONTH futures price — using it for a
        # weekly chain overstates the forward by the extra weeks of carry,
        # which makes ITM call premiums look below intrinsic and the IV solver
        # return 0/None for the whole call side. Parity first; carry-adjusted
        # spot as fallback; `fp` only as a last resort.
        forward = 0.0
        disc = math.exp(-0.065 * t_years)
        by_strike: dict[float, dict[str, float]] = {}
        for leg in raw_legs:
            if leg["ltp"] > 0:
                by_strike.setdefault(leg["strike"], {})[leg["option_type"]] = leg["ltp"]
        parity = [
            (abs(k - spot), k, v["CE"], v["PE"])
            for k, v in by_strike.items()
            if "CE" in v and "PE" in v and spot > 0
        ]
        if parity:
            _, k, c, p = min(parity)
            forward = k + (c - p) / disc
        elif spot > 0:
            forward = spot * math.exp(0.065 * t_years)
        else:
            forward = fp

        # Second pass: recover IV from each premium (Fyers doesn't return IV)
        # and compute greeks from the same Black-76 model.
        rows = []
        total_call = 0
        total_put  = 0

        for leg in raw_legs:
            otype, strike, ltp, oi = leg["option_type"], leg["strike"], leg["ltp"], leg["oi"]
            iv = implied_vol(otype, ltp, forward or spot, strike, t_years)
            g = greeks(otype, forward or spot, strike, t_years, (iv or 0.0) / 100.0)

            rows.append({
                **leg,
                # None (not 0.0) when unrecoverable — the DB ck_ocr_iv
                # constraint rejects iv=0 and the UI renders None as "—".
                "iv":    iv,
                "delta": g["delta"],
                "theta": g["theta"],
                "vega":  g["vega"],
                "gamma": g["gamma"],
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