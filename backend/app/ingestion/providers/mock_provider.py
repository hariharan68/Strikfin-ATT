"""
ingestion/providers/mock_provider.py
-------------------------------------
Mock market data provider for development.
Returns realistic but randomised NIFTY & SENSEX data.
No vendor account needed — works out of the box.

When you sign a real vendor (GlobalDatafeeds / TrueData),
you create a new file in this folder and update .env:
    MARKET_DATA_VENDOR=globaldatafeeds
The rest of the app never changes.
"""
import random
from datetime import datetime, timezone


# ─────────────────────────────────────────────────────────────
# BASE PRICES
# ─────────────────────────────────────────────────────────────

# Synthetic base prices are mock-only dev fixtures (fake data), keyed by id with
# a generic fallback. Instrument IDENTITY (symbol, strike step) comes from the
# Instrument Master snapshot via the helpers below — NOT hardcoded here.
_BASE = {
    1: 24_350.0,   # NIFTY 50
    2: 80_450.0,   # SENSEX
}

_BASE_VIX = 14.5


def _symbol(instrument_id: int) -> str:
    from app.instruments import snapshot
    r = snapshot.get(instrument_id)
    return r.symbol if r else "UNKNOWN"


def _step(instrument_id: int) -> float:
    from app.instruments import snapshot
    r = snapshot.get(instrument_id)
    return float(r.strike_step) if r and r.strike_step else 50.0


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _walk(base: float, vol: float = 0.002) -> float:
    """Small random price walk around base."""
    return round(base * (1 + random.gauss(0, vol)), 2)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────
# SPOT
# ─────────────────────────────────────────────────────────────

def get_spot(instrument_id: int) -> dict:
    """
    Returns a live-style spot price snapshot.
    Keys mirror the IndexLiveData ORM model.
    """
    base      = _BASE.get(instrument_id, 24_000.0)
    ltp       = _walk(base)
    prev      = round(base * random.uniform(0.990, 1.010), 2)
    chg_pct   = round((ltp - prev) / prev * 100, 3)

    return {
        "instrument_id": instrument_id,
        "symbol":        _symbol(instrument_id),
        "last_price":    ltp,
        "open_price":    round(prev * random.uniform(0.999, 1.001), 2),
        "high_price":    round(ltp  * random.uniform(1.001, 1.008), 2),
        "low_price":     round(ltp  * random.uniform(0.992, 0.999), 2),
        "prev_close":    prev,
        "change_pct":    chg_pct,
        "india_vix":     round(_BASE_VIX + random.gauss(0, 0.5), 3),
        "snap_ts":       _now(),
    }


# ─────────────────────────────────────────────────────────────
# FUTURES
# ─────────────────────────────────────────────────────────────

_FUT_PREMIUM = {1: 30.0, 2: 80.0}   # typical near-month premium over spot

def get_futures(instrument_id: int) -> dict:
    base    = _BASE.get(instrument_id, 24_000.0)
    premium = _FUT_PREMIUM.get(instrument_id, 30.0)
    ltp     = round(_walk(base) + premium, 2)
    prev    = round((base + premium) * random.uniform(0.990, 1.010), 2)
    chg_pct = round((ltp - prev) / prev * 100, 3)
    symbol  = _symbol(instrument_id)
    return {
        "instrument_id":  instrument_id,
        "symbol":         symbol,
        "futures_symbol": f"MOCK:{symbol}FUT",
        "last_price":     ltp,
        "prev_close":     prev,
        "change":         round(ltp - prev, 2),
        "change_pct":     chg_pct,
        "volume":         random.randint(50_000, 500_000),
        "open_price":     round(prev * random.uniform(0.999, 1.001), 2),
        "high_price":     round(ltp  * random.uniform(1.001, 1.008), 2),
        "low_price":      round(ltp  * random.uniform(0.992, 0.999), 2),
        "snap_ts":        _now(),
        "source":         "mock",
    }


# ─────────────────────────────────────────────────────────────
# OPTION CHAIN
# ─────────────────────────────────────────────────────────────

def get_option_chain(
    instrument_id: int,
    expiry_date: str = "2026-06-26",
) -> dict:
    """
    Returns a full option chain — 10 strikes each side of ATM.
    Keys mirror OptionChainSnapshot + OptionChainRow ORM models.
    """
    base  = _BASE.get(instrument_id, 24_000.0)
    spot  = _walk(base)
    step  = _step(instrument_id)

    # ATM strike
    atm = round(spot / step) * step

    # 10 strikes each side
    strikes = [atm + (i - 10) * step for i in range(21)]

    rows         = []
    total_call   = 0
    total_put    = 0

    for strike in strikes:
        distance  = abs(strike - spot) / spot
        base_oi   = int(random.randint(50_000, 500_000) / (1 + distance * 8))
        oi_chg    = int(random.gauss(0, base_oi * 0.05))

        # ── CE row ───────────────────────────────────────────
        ce_oi  = max(0, base_oi + random.randint(-20_000, 20_000))
        ce_vol = int(ce_oi * random.uniform(0.05, 0.20))
        total_call += ce_oi

        rows.append({
            "strike":      strike,
            "option_type": "CE",
            "ltp":         round(max(0.5, max(0, spot - strike) + random.uniform(1, 20)), 2),
            "oi":          ce_oi,
            "oi_change":   oi_chg,
            "volume":      ce_vol,
            "iv":          round(random.uniform(10, 20) + distance * 30, 3),
            "delta":       round(max(-1, min(1, 0.5 - distance * 1.5)), 4),
            "theta":       round(-random.uniform(2, 8), 4),
            "vega":        round(random.uniform(10, 40), 4),
            "gamma":       round(random.uniform(0.00005, 0.0005), 6),
        })

        # ── PE row ───────────────────────────────────────────
        pe_oi  = max(0, base_oi + random.randint(-20_000, 20_000))
        pe_vol = int(pe_oi * random.uniform(0.05, 0.20))
        total_put += pe_oi

        rows.append({
            "strike":      strike,
            "option_type": "PE",
            "ltp":         round(max(0.5, max(0, strike - spot) + random.uniform(1, 20)), 2),
            "oi":          pe_oi,
            "oi_change":   -oi_chg,
            "volume":      pe_vol,
            "iv":          round(random.uniform(10, 20) + distance * 35, 3),
            "delta":       round(min(0, max(-1, -0.5 + distance * 1.5)), 4),
            "theta":       round(-random.uniform(2, 8), 4),
            "vega":        round(random.uniform(10, 40), 4),
            "gamma":       round(random.uniform(0.00005, 0.0005), 6),
        })

    pcr = round(total_put / total_call, 4) if total_call else 1.0

    return {
        "instrument_id": instrument_id,
        "snap_ts":       _now(),
        "expiry_date":   expiry_date,
        "spot":          spot,
        "atm_strike":    atm,
        "total_call_oi": total_call,
        "total_put_oi":  total_put,
        "pcr_oi":        pcr,
        "rows":          rows,
    }


# ─────────────────────────────────────────────────────────────
# HISTORICAL CANDLES
# ─────────────────────────────────────────────────────────────

def get_history(instrument_id: int, days: int = 60, resolution: str = "D") -> dict:
    """
    Synthetic daily OHLC candles (oldest→newest) for ATR/ADX/realized-vol
    development. A gentle random walk around the base price with realistic
    intraday ranges. Deterministic enough to be useful, random enough to
    exercise the math.
    """
    base = _BASE.get(instrument_id, 24_000.0)
    candles = []
    close = base * 0.97  # start a bit below base so the series drifts up
    now_ts = int(datetime.now(timezone.utc).timestamp())
    for i in range(days, 0, -1):
        drift = close * random.gauss(0.0005, 0.008)
        open_ = close
        close = round(open_ + drift, 2)
        high  = round(max(open_, close) * random.uniform(1.001, 1.010), 2)
        low   = round(min(open_, close) * random.uniform(0.990, 0.999), 2)
        candles.append({
            "ts":     now_ts - i * 86400,
            "open":   round(open_, 2),
            "high":   high,
            "low":    low,
            "close":  close,
            "volume": random.randint(100_000, 900_000),
        })
    return {"instrument_id": instrument_id, "candles": candles, "source": "mock"}


# ─────────────────────────────────────────────────────────────
# INSTITUTIONAL ACTIVITY
# ─────────────────────────────────────────────────────────────

def get_institutional_activity(trade_date: str) -> list[dict]:
    """
    Simulates EOD FII/DII cash and F&O participant data.
    Real data comes from NSE/BSE EOD reports post 16:00 IST.
    """
    fii_buy  = round(random.uniform(3_000, 8_000), 2)
    fii_sell = round(random.uniform(3_000, 8_000), 2)
    dii_buy  = round(random.uniform(2_000, 7_000), 2)
    dii_sell = round(random.uniform(2_000, 7_000), 2)

    return [
        {
            "category":      "FII",
            "segment":       "CASH",
            "buy_value_cr":  fii_buy,
            "sell_value_cr": fii_sell,
            "net_value_cr":  round(fii_buy - fii_sell, 2),
            "is_provisional": True,
        },
        {
            "category":      "DII",
            "segment":       "CASH",
            "buy_value_cr":  dii_buy,
            "sell_value_cr": dii_sell,
            "net_value_cr":  round(dii_buy - dii_sell, 2),
            "is_provisional": True,
        },
        {
            "category":       "FII",
            "segment":        "IDX_FUT",
            "long_contracts":  random.randint(10_000, 80_000),
            "short_contracts": random.randint(10_000, 80_000),
            "net_value_cr":    round(random.uniform(-2_000, 2_000), 2),
            "is_provisional":  True,
        },
    ]


# ─────────────────────────────────────────────────────────────
# NEWS HEADLINES
# ─────────────────────────────────────────────────────────────

_HEADLINES = [
    ("RBI keeps repo rate unchanged at 6.5%, accommodative stance maintained", "RBI"),
    ("FII buying resumes — net inflows of ₹2,300 cr in equities today",        "MACRO"),
    ("NIFTY 50 hits fresh 52-week high on broad-based buying",                  "INDEX"),
    ("Global cues positive — US markets close higher on Fed rate cut hopes",    "GLOBAL"),
    ("India CPI at 4.9% in May, within RBI comfort zone",                      "MACRO"),
    ("Crude oil slides below $80 — positive for import-heavy India",            "GLOBAL"),
    ("Sensex, Nifty edge lower amid profit-booking at higher levels",           "INDEX"),
    ("DII absorbs FII selling — domestic flows remain strong",                  "MACRO"),
    ("IT stocks under pressure on weak US tech earnings guidance",              "EARNINGS"),
    ("India Q1 GDP growth at 7.2%, beats street estimates",                     "MACRO"),
    ("GIFT Nifty signals flat opening — global cues mixed",                     "GLOBAL"),
    ("Rupee strengthens to 83.20 against dollar on RBI intervention",           "MACRO"),
]

_SOURCES = [
    "Economic Times",
    "Moneycontrol",
    "LiveMint",
    "Business Standard",
]


def get_news_headlines(limit: int = 8) -> list[dict]:
    """Returns a random sample of market headlines."""
    sample = random.sample(_HEADLINES, min(limit, len(_HEADLINES)))
    now    = _now()

    return [
        {
            "source":       random.choice(_SOURCES),
            "headline":     headline,
            "category":     category,
            "published_at": now,
            "url":          f"https://example.com/news/{i}",
        }
        for i, (headline, category) in enumerate(sample)
    ]