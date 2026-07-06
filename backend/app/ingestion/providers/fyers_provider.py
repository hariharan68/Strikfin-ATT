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
# Timestamp of the last batched spot-refresh ATTEMPT (success or failure). The
# refresh runs at most once per _SPOT_TTL window, so a rate-limited (429) attempt
# fails once per cycle instead of every spot/futures caller re-firing quotes().
_last_spot_refresh = 0.0


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

# ── Instrument symbol resolution — from the Instrument Master snapshot ────────
# Symbols, strike step and the futures template all come from the DB-backed
# instrument snapshot (app.instruments.snapshot), NOT hardcoded per-id dicts.
# The snapshot is hydrated from the DB at startup and lazily seeds itself from
# the canonical DEFAULT_INSTRUMENTS if a sync caller hits it pre-hydration.
_VIX_SYMBOL = "NSE:INDIAVIX-INDEX"   # market-wide (India VIX), not per-instrument


def _ref(instrument_id: int):
    from app.instruments import snapshot
    return snapshot.get(instrument_id)


def _spot_symbol(instrument_id: int) -> Optional[str]:
    r = _ref(instrument_id)
    return r.vendor_symbol("fyers", "spot") if r else None


def _option_symbol(instrument_id: int) -> Optional[str]:
    r = _ref(instrument_id)
    return r.vendor_symbol("fyers", "option") if r else None


def _display(instrument_id: int) -> str:
    r = _ref(instrument_id)
    return r.symbol if r else "UNKNOWN"


def _strike_step(instrument_id: int) -> float:
    r = _ref(instrument_id)
    return float(r.strike_step) if r and r.strike_step else 50.0


def _spot_instrument_ids() -> list[int]:
    """Active instruments that have a Fyers spot symbol — the set refreshed
    together in the single batched quotes() call."""
    from app.instruments import snapshot
    return [r.instrument_id for r in snapshot.all_active() if r.vendor_symbol("fyers", "spot")]


def _near_month_futures_symbol(instrument_id: int) -> Optional[str]:
    """Fyers current-month futures symbol, built generically from the
    instrument's vendor futures_template + expiry_rule (no per-id branch)."""
    from app.market_data.expiry import build_fyers_futures_symbol
    return build_fyers_futures_symbol(_ref(instrument_id))


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

def _ensure_spots_fresh() -> None:
    """Run the single batched spot + VIX + FUTURES refresh at most once per
    _SPOT_TTL window. Shared by get_spot AND get_futures so a dashboard cycle
    (spot + futures for every instrument) collapses into ONE quotes() call.

    The timestamp guard is the anti-429 hardening: when the batched call is
    rate-limited it fails ONCE per window; callers then read last-good/mock from
    cache instead of each re-firing quotes() and deepening the throttle.
    """
    global _last_spot_refresh
    if time.time() - _last_spot_refresh < _SPOT_TTL:
        return
    with _spot_refresh_lock:
        # A parallel thread may have refreshed while we waited for the lock.
        if time.time() - _last_spot_refresh < _SPOT_TTL:
            return
        try:
            _refresh_all_spots()
        finally:
            _last_spot_refresh = time.time()


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

    _ensure_spots_fresh()

    cached = _cache_get(("spot", instrument_id), _SPOT_TTL)
    if cached is not None:
        return cached
    # Batched refresh was skipped (guard) or didn't populate — derive real spot
    # directly from the un-throttled option chain before dropping to mock.
    spot_d, _ = _spot_and_fut_from_chain(instrument_id)
    if spot_d is not None:
        _cache_put(("spot", instrument_id), spot_d)
        return spot_d
    return _mock_spot(instrument_id)


def _mock_spot(instrument_id: int) -> dict:
    """Mock spot, tagged so history ingestion never persists it as real data."""
    from app.ingestion.providers.mock_provider import get_spot as mock_spot
    result = mock_spot(instrument_id)
    result["source"] = "mock_fallback"
    return result


def _spot_and_fut_from_chain(instrument_id: int) -> tuple[Optional[dict], Optional[dict]]:
    """Recover REAL spot + current-month futures from the option chain when the
    quotes() endpoint is rate-limited (429).

    The Quotes API and the Option-Chain API have SEPARATE rate quotas on Fyers,
    so the chain often works when quotes() is throttled. The chain's underlying
    entry carries the live index ltp (spot) and `fp` (near-month futures), so we
    can keep the dashboard on real prices instead of dropping to mock. Tagged
    ``source="fyers_chain"`` (a real source) so it is displayed and persisted.
    Change% reuses the last-good previous close (which doesn't move intraday).
    Returns (spot_dict|None, fut_dict|None); never raises.
    """
    try:
        chain = get_option_chain(instrument_id)
        if chain.get("source") not in ("fyers", "fyers_cached"):
            return None, None
        spot_px = float(chain.get("spot") or 0)
        fp = float(chain.get("fp") or 0)
        now_iso = datetime.now(timezone.utc).isoformat()
        lg = _LAST_GOOD.get(("spot", instrument_id), {})

        spot_d = None
        if spot_px > 0:
            prev = float(lg.get("prev_close") or 0) or spot_px
            spot_d = {
                "instrument_id": instrument_id,
                "symbol":        _display(instrument_id),
                "last_price":    spot_px,
                "prev_close":    prev,
                "change_pct":    round((spot_px - prev) / prev * 100, 3) if prev else 0.0,
                "open_price":    lg.get("open_price"),
                "high_price":    lg.get("high_price"),
                "low_price":     lg.get("low_price"),
                "volume":        lg.get("volume"),
                "india_vix":     lg.get("india_vix"),
                "snap_ts":       now_iso,
                "source":        "fyers_chain",
            }

        fut_d = None
        if fp > 0:
            lgf = _LAST_GOOD.get(("futures", instrument_id), {})
            fprev = float(lgf.get("prev_close") or 0) or fp
            fut_d = {
                "instrument_id":  instrument_id,
                "symbol":         _display(instrument_id),
                "futures_symbol": _near_month_futures_symbol(instrument_id),
                "last_price":     fp,
                "prev_close":     fprev,
                "change":         round(fp - fprev, 2),
                "change_pct":     round((fp - fprev) / fprev * 100, 3) if fprev else 0.0,
                "volume":         int(lgf.get("volume") or 0),
                "open_price":     None,
                "high_price":     None,
                "low_price":      None,
                "snap_ts":        now_iso,
                "source":         "fyers_chain",
            }
        return spot_d, fut_d
    except Exception as e:
        logger.warning(f"chain-derived spot/futures failed for {instrument_id}: {e}")
        return None, None


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
    insts = _spot_instrument_ids()
    spot_symbols = {i: _spot_symbol(i) for i in insts}
    fut_symbols = {i: _near_month_futures_symbol(i) for i in insts}

    try:
        fyers   = _get_fyers()
        symbols = ",".join(
            [spot_symbols[i] for i in insts]
            + [_VIX_SYMBOL]
            + [fut_symbols[i] for i in insts if fut_symbols[i]]
        )
        data = fyers.quotes({"symbols": symbols})

        if data.get("code") != 200 or not data.get("d"):
            raise ValueError(f"Fyers quotes error: {data}")

        by_symbol = {d.get("n"): d.get("v", {}) for d in data["d"]}

        vq = by_symbol.get(_VIX_SYMBOL, {})
        vix = float(vq.get("lp", 0) or 0) or None

        for iid in insts:
            q = by_symbol.get(spot_symbols[iid])
            if q:
                ltp     = float(q.get("lp", 0))
                prev    = float(q.get("prev_close_price", ltp) or ltp)
                chg_pct = round((ltp - prev) / prev * 100, 3) if prev else 0.0
                live[iid] = {
                    "instrument_id": iid,
                    "symbol":        _display(iid),
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

            fq = by_symbol.get(fut_symbols[iid]) if fut_symbols[iid] else None
            if fq and float(fq.get("lp", 0) or 0) > 0:
                fltp = float(fq.get("lp", 0))
                fprev = float(fq.get("prev_close_price", fltp) or fltp)
                futs[iid] = {
                    "instrument_id":  iid,
                    "symbol":         _display(iid),
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
            {_display(i): live[i]["last_price"] for i in live},
            vix,
            {_display(i): futs[i]["last_price"] for i in futs},
        )

    except Exception as e:
        logger.warning(f"Fyers batched spot failed — using last-good/mock: {e}")

    for iid in insts:
        # When the batched quotes() didn't return live spot/futures (typically a
        # 429), recover REAL values from the un-throttled option chain before
        # falling back to stale last-good or mock. Only fetch the chain if we
        # actually need it, and only once per instrument.
        chain_spot = chain_fut = None
        if iid not in live or iid not in futs:
            chain_spot, chain_fut = _spot_and_fut_from_chain(iid)

        if iid in live:
            _LAST_GOOD[("spot", iid)] = live[iid]
            _cache_put(("spot", iid), live[iid])
        elif chain_spot is not None:
            _cache_put(("spot", iid), chain_spot)
        elif ("spot", iid) in _LAST_GOOD:
            stale = dict(_LAST_GOOD[("spot", iid)])
            stale["source"] = "fyers_cached"
            if vix is not None:  # a fresh VIX is still worth surfacing
                stale["india_vix"] = vix
            _cache_put(("spot", iid), stale)
        else:
            _cache_put(("spot", iid), _mock_spot(iid))

        # Pre-fill the futures cache so get_futures() hits it (no extra call).
        # Only cache real values (live quotes OR chain-derived fp) — never mock —
        # so the snapshot's future_price stays NULL (→ spot fallback) rather than
        # storing a fake futures price.
        if iid in futs:
            _LAST_GOOD[("futures", iid)] = futs[iid]
            _cache_put(("futures", iid), futs[iid])
        elif chain_fut is not None:
            _cache_put(("futures", iid), chain_fut)
        elif ("futures", iid) in _LAST_GOOD:
            stale_f = dict(_LAST_GOOD[("futures", iid)])
            stale_f["source"] = "fyers_cached"
            _cache_put(("futures", iid), stale_f)


# ─────────────────────────────────────────────────────────────
# FUTURES
# ─────────────────────────────────────────────────────────────

def get_futures(instrument_id: int) -> dict:
    """
    Current-month FUTURES price + volume for NIFTY / SENSEX.

    Futures rides in the SAME batched quotes() call as spot + VIX
    (_refresh_all_spots pre-fills the ("futures", id) cache), so this costs no
    extra Fyers hit. It deliberately does NOT make its own quotes() call: a
    separate futures fetch used to fire alongside the batched spot call, which
    tripled the quotes() load exactly when the endpoint was rate-limited and
    turned a transient 429 into a self-sustaining storm. On a batch miss/429 we
    serve last-good (from the cache _refresh_all_spots fills) or a mock — never
    an extra request.
    """
    cached = _cache_get(("futures", instrument_id), _SPOT_TTL)
    if cached is not None:
        return cached

    _ensure_spots_fresh()

    cached = _cache_get(("futures", instrument_id), _SPOT_TTL)
    if cached is not None:
        return cached
    # Batched refresh was skipped (guard) or didn't populate — derive real
    # futures (fp) directly from the un-throttled option chain before mock.
    _, fut_d = _spot_and_fut_from_chain(instrument_id)
    if fut_d is not None:
        _cache_put(("futures", instrument_id), fut_d)
        return fut_d
    return _mock_futures(instrument_id)


def _mock_futures(instrument_id: int) -> dict:
    """Zero/mock futures, source-tagged so options_service never persists it as a
    real future_price (it keeps future_price NULL → spot fallback). Deliberately
    NOT cached, so the ("futures", id) key stays empty for the next batched
    refresh to fill with a live value."""
    return {
        "instrument_id":  instrument_id,
        "symbol":         _display(instrument_id),
        "futures_symbol": _near_month_futures_symbol(instrument_id),
        "last_price":     0.0,
        "prev_close":     0.0,
        "change":         0.0,
        "change_pct":     0.0,
        "volume":         0,
        "open_price":     None,
        "high_price":     None,
        "low_price":      None,
        "snap_ts":        datetime.now(timezone.utc).isoformat(),
        "source":         "mock_fallback",
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
        symbol = _spot_symbol(instrument_id) or "NSE:NIFTY50-INDEX"
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
        logger.info(f"Fyers history: {_display(instrument_id)} {len(candles)} {resolution} candles")
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
        symbol = _option_symbol(instrument_id) or "NSE:NIFTY50"

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
            f"Fyers chain: {_display(instrument_id)} "
            f"{len(rows)} rows PCR={pcr}"
        )

        return {
            "instrument_id": instrument_id,
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "expiry_date":   expiry,
            "spot":          spot,
            # Near-month FUTURES price of the underlying (Fyers `fp`). Exposed so
            # spot/futures can be recovered from the (un-throttled) chain endpoint
            # when the quotes() API is rate-limited — see _spot_and_fut_from_chain.
            "fp":            fp,
            "atm_strike":    _nearest_atm(spot, rows, _strike_step(instrument_id)),
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

def _nearest_atm(spot: float, rows: list[dict], step: float = 50.0) -> float:
    """Find the nearest strike to spot from chain rows; fall back to the
    instrument's strike step when there are no rows."""
    strikes = list({r["strike"] for r in rows})
    if not strikes:
        step = step or 50.0
        return round(spot / step) * step
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