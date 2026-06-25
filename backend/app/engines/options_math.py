"""
engines/options_math.py
-----------------------
Pure options math functions.
Zero DB, zero network, zero FastAPI imports.
Every function is independently unit-testable.
"""
import math
from dataclasses import dataclass
from typing import Optional


# ─────────────────────────────────────────────────────────────
# DATA CLASS
# ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ChainRow:
    strike:       float
    opt_type:     str    # "CE" | "PE"
    oi:           int
    oi_change:    int
    ltp:          float
    volume:       int
    price_change: float  # underlying % change since prev snapshot
    iv:           Optional[float] = None


# ─────────────────────────────────────────────────────────────
# PCR
# ─────────────────────────────────────────────────────────────

def pcr_oi(rows: list[ChainRow]) -> float:
    """
    Put-Call Ratio by Open Interest.
    Formula: Total Put OI / Total Call OI
    > 1.2  → put-heavy (bearish hedge or bullish put writing)
    < 0.8  → call-heavy (bullish speculation or bearish call writing)
    """
    put_oi  = sum(r.oi for r in rows if r.opt_type == "PE")
    call_oi = sum(r.oi for r in rows if r.opt_type == "CE")
    return round(put_oi / call_oi, 4) if call_oi > 0 else 0.0


def pcr_volume(rows: list[ChainRow]) -> float:
    """
    Put-Call Ratio by Volume.
    More responsive intraday than OI-based PCR.
    """
    put_vol  = sum(r.volume for r in rows if r.opt_type == "PE")
    call_vol = sum(r.volume for r in rows if r.opt_type == "CE")
    return round(put_vol / call_vol, 4) if call_vol > 0 else 0.0


# ─────────────────────────────────────────────────────────────
# BUILD-UP CLASSIFICATION
# ─────────────────────────────────────────────────────────────

_BUILDUP_MAP = {
    (True,  True):  (1, "LONG_BUILDUP"),    # Price↑ OI↑ → fresh longs
    (False, True):  (2, "SHORT_BUILDUP"),   # Price↓ OI↑ → fresh shorts
    (True,  False): (3, "SHORT_COVERING"),  # Price↑ OI↓ → shorts exiting
    (False, False): (4, "LONG_UNWINDING"),  # Price↓ OI↓ → longs exiting
}


def classify_buildup(
    price_chg: float,
    oi_chg: int,
) -> tuple[int, str]:
    """
    Classifies position build-up from price and OI direction.

    ``price_chg`` must be the *option's effective price direction*:
    - For CE: pass the underlying spot change % as-is.
    - For PE: pass the underlying spot change % **negated** (-change_pct),
      because put premiums move opposite to the underlying.

    Returns (code, label):
        1  LONG_BUILDUP    price↑ oi↑
        2  SHORT_BUILDUP   price↓ oi↑
        3  SHORT_COVERING  price↑ oi↓
        4  LONG_UNWINDING  price↓ oi↓
    """
    key = (price_chg >= 0, oi_chg >= 0)
    return _BUILDUP_MAP[key]


# ─────────────────────────────────────────────────────────────
# MAX PAIN
# ─────────────────────────────────────────────────────────────

def max_pain(rows: list[ChainRow], strikes: list[float]) -> float:
    """
    Max Pain = expiry price where total intrinsic payout
    to ALL option holders is minimised.

    Formula per candidate price P:
        pain(P) = Σ CE_OI × max(0, P − strike)
                + Σ PE_OI × max(0, strike − P)

    Gravity zone near expiry — especially last 2–3 days.
    Returns 0.0 if no strikes provided.
    """
    if not strikes:
        return 0.0

    ce_rows = [(r.strike, r.oi) for r in rows if r.opt_type == "CE"]
    pe_rows = [(r.strike, r.oi) for r in rows if r.opt_type == "PE"]

    def total_pain(px: float) -> float:
        pain  = sum(max(0.0, px - s) * oi for s, oi in ce_rows)
        pain += sum(max(0.0, s - px) * oi for s, oi in pe_rows)
        return pain

    return min(strikes, key=total_pain)


# ─────────────────────────────────────────────────────────────
# OI WALLS  (support / resistance)
# ─────────────────────────────────────────────────────────────

def oi_walls(
    rows: list[ChainRow],
    spot: float,
    nearby_strikes: int = 10,
) -> dict:
    """
    Support  = highest PE OI strike BELOW spot (put writers defend here)
    Resistance = highest CE OI strike ABOVE spot (call writers defend here)

    Only looks at nearby_strikes ATM context to
    avoid distant illiquid strikes dominating.
    """
    all_strikes = sorted({r.strike for r in rows})
    if not all_strikes:
        return {"support": None, "resistance": None, "atm": spot}

    atm = min(all_strikes, key=lambda s: abs(s - spot))
    idx = all_strikes.index(atm)

    lo = max(0, idx - nearby_strikes)
    hi = min(len(all_strikes), idx + nearby_strikes + 1)
    relevant = set(all_strikes[lo:hi])

    calls = [r for r in rows if r.opt_type == "CE"
             and r.strike > spot and r.strike in relevant]
    puts  = [r for r in rows if r.opt_type == "PE"
             and r.strike < spot and r.strike in relevant]

    resistance = max(calls, key=lambda r: r.oi).strike if calls else None
    support    = max(puts,  key=lambda r: r.oi).strike if puts  else None

    return {"support": support, "resistance": resistance, "atm": atm}


# ─────────────────────────────────────────────────────────────
# ATM STRIKE
# ─────────────────────────────────────────────────────────────

def atm_strike(spot: float, strikes: list[float]) -> float:
    """Nearest strike to current spot price."""
    if not strikes:
        return round(spot / 50) * 50  # fallback
    return min(strikes, key=lambda s: abs(s - spot))


# ─────────────────────────────────────────────────────────────
# IMPLIED VOLATILITY
# ─────────────────────────────────────────────────────────────

# Fyers' option-chain feed does NOT return implied volatility or greeks
# (only OI, LTP, volume). So we recover IV ourselves by inverting the
# Black-76 pricing formula (European index options, priced off the
# forward). India risk-free proxy ~6.5%.
_RISK_FREE = 0.065


def _norm_cdf(x: float) -> float:
    """Standard normal CDF via the error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black76_price(
    opt_type: str,
    forward:  float,
    strike:   float,
    t_years:  float,
    sigma:    float,
    r:        float = _RISK_FREE,
) -> float:
    """Black-76 price of a European CE/PE on a forward `forward`."""
    if t_years <= 0 or sigma <= 0 or forward <= 0 or strike <= 0:
        return 0.0
    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(forward / strike) + 0.5 * sigma * sigma * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    disc = math.exp(-r * t_years)
    if opt_type == "CE":
        return disc * (forward * _norm_cdf(d1) - strike * _norm_cdf(d2))
    return disc * (strike * _norm_cdf(-d2) - forward * _norm_cdf(-d1))


def _norm_pdf(x: float) -> float:
    """Standard normal probability density."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def greeks(
    opt_type: str,
    forward:  float,
    strike:   float,
    t_years:  float,
    sigma:    float,   # decimal, e.g. 0.13 for 13%
    r:        float = _RISK_FREE,
) -> dict[str, float]:
    """
    Black-76 greeks for a European CE/PE on a forward.
      delta — per 1 pt move in the underlying
      gamma — per 1 pt move (rate of change of delta)
      vega  — per 1% change in IV
      theta — per CALENDAR DAY (premium decay)
    Returns zeros when inputs are degenerate (expiry/no-vol).
    """
    if t_years <= 0 or sigma <= 0 or forward <= 0 or strike <= 0:
        return {"delta": 0.0, "gamma": 0.0, "vega": 0.0, "theta": 0.0}

    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(forward / strike) + 0.5 * sigma * sigma * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    disc = math.exp(-r * t_years)
    nd1  = _norm_pdf(d1)

    if opt_type == "CE":
        delta = disc * _norm_cdf(d1)
    else:
        delta = disc * (_norm_cdf(d1) - 1.0)

    gamma = disc * nd1 / (forward * sigma * sqrt_t)
    vega  = forward * disc * nd1 * sqrt_t / 100.0
    price = black76_price(opt_type, forward, strike, t_years, sigma, r)
    theta = (r * price - forward * disc * nd1 * sigma / (2.0 * sqrt_t)) / 365.0

    return {
        "delta": round(delta, 4),
        "gamma": round(gamma, 8),
        "vega":  round(vega, 4),
        "theta": round(theta, 4),
    }


def implied_vol(
    opt_type: str,
    premium:  float,
    forward:  float,
    strike:   float,
    t_years:  float,
    r:        float = _RISK_FREE,
) -> Optional[float]:
    """
    Implied volatility (in PERCENT) recovered from an option premium by
    bisecting Black-76. Vega is positive and monotonic in sigma, so
    bisection converges reliably. Returns None when the premium is
    unusable (zero, below intrinsic, or non-convergent).
    """
    if premium <= 0 or forward <= 0 or strike <= 0 or t_years <= 0:
        return None

    disc = math.exp(-r * t_years)
    intrinsic = (
        disc * max(forward - strike, 0.0) if opt_type == "CE"
        else disc * max(strike - forward, 0.0)
    )
    # Premium below intrinsic → stale/bad quote; can't imply a vol.
    if premium < intrinsic - 0.01:
        return None

    lo, hi = 1e-4, 5.0  # sigma search bracket: 0.01% … 500%
    for _ in range(100):
        mid   = 0.5 * (lo + hi)
        price = black76_price(opt_type, forward, strike, t_years, mid, r)
        if abs(price - premium) < 0.01:
            return round(mid * 100.0, 2)
        if price > premium:
            hi = mid
        else:
            lo = mid
    return round(0.5 * (lo + hi) * 100.0, 2)


def atm_iv(rows: list[ChainRow], atm: float) -> Optional[float]:
    """
    At-the-money implied volatility — mean of CE and PE IV at the
    ATM strike. The market's expected forward volatility.
    Returns None if no IV data at the ATM strike.
    """
    # IV is never legitimately 0 for a liquid ATM option — a 0/None
    # value means the feed has no IV (e.g. outside market hours), so
    # treat it as missing rather than reporting a misleading zero.
    ivs = [r.iv for r in rows if r.strike == atm and r.iv and r.iv > 0]
    return round(sum(ivs) / len(ivs), 2) if ivs else None


# Typical NIFTY/SENSEX ATM IV band (low-vol calm → high-vol stress).
# Used as the reference range for the percentile proxy until a real
# rolling 1-year IV history is wired in.
_IV_BAND_LO = 10.0
_IV_BAND_HI = 25.0


def iv_percentile(
    atm_iv_val: Optional[float],
    lo: float = _IV_BAND_LO,
    hi: float = _IV_BAND_HI,
) -> Optional[float]:
    """
    Where current ATM IV sits within its typical range, 0–100.

    Production: percentile of current IV vs trailing 1-year IV series.
    Here: linear position within the [lo, hi] band as a deterministic
    proxy (no history in a single snapshot). Clamped to 0–100.
    """
    if atm_iv_val is None or hi <= lo:
        return None
    pct = (atm_iv_val - lo) / (hi - lo) * 100.0
    return round(min(max(pct, 0.0), 100.0), 2)


def iv_percentile_label(pct: Optional[float]) -> Optional[str]:
    """Plain-English IV regime band."""
    if pct is None:
        return None
    if pct >= 80:
        return "Very High"
    if pct >= 60:
        return "High"
    if pct >= 40:
        return "Moderate"
    if pct >= 20:
        return "Low"
    return "Very Low"

# ─────────────────────────────────────────────────────────────
# GAMMA EXPOSURE (GEX)
# ─────────────────────────────────────────────────────────────

# Contract lot sizes for notional scaling. Update if the exchange revises them.
LOT_SIZE = {1: 75, 2: 20}  # 1=NIFTY, 2=SENSEX


def net_gex(rows: list[dict], spot: float, lot_size: int) -> Optional[float]:
    """
    Dealer gamma exposure, in ₹ Crore per 1% spot move.

    Convention: dealers are long calls / short puts, so call gamma adds and
    put gamma subtracts.
        Positive GEX → dealers dampen moves (price tends to PIN).
        Negative GEX → dealers amplify moves (trend / breakout fuel).
    Magnitude is a relative gauge, not an exact rupee figure.
    """
    if not spot or spot <= 0:
        return None
    total = 0.0
    for r in rows:
        g  = r.get("gamma") or 0.0
        oi = r.get("oi") or 0
        if g <= 0 or oi <= 0:
            continue
        sign = 1.0 if r.get("option_type") == "CE" else -1.0
        total += sign * g * oi * lot_size
    gex = total * spot * spot * 0.01      # ₹ per 1% move
    return round(gex / 1e7, 2)            # → Crore


def gamma_flip_strike(rows: list[dict], spot: float) -> Optional[float]:
    """
    Approximate zero-gamma level: the strike where cumulative signed
    gamma·OI (summed low→high) flips sign. Price above tends to mean-revert;
    below tends to trend.
    """
    by_strike: dict[float, float] = {}
    for r in rows:
        g  = r.get("gamma") or 0.0
        oi = r.get("oi") or 0
        if g <= 0 or oi <= 0:
            continue
        sign = 1.0 if r.get("option_type") == "CE" else -1.0
        by_strike[r["strike"]] = by_strike.get(r["strike"], 0.0) + sign * g * oi

    if not by_strike:
        return None
    cum = prev_cum = 0.0
    prev_strike: Optional[float] = None
    for k in sorted(by_strike):
        cum += by_strike[k]
        if prev_strike is not None and ((prev_cum < 0 <= cum) or (prev_cum > 0 >= cum)):
            return prev_strike
        prev_strike, prev_cum = k, cum
    return None


def gex_label(gex: Optional[float]) -> Optional[str]:
    """Plain-English GEX regime."""
    if gex is None:
        return None
    if gex > 0:
        return "Positive — vol suppressed / pinned"
    if gex < 0:
        return "Negative — moves amplified"
    return "Neutral"

# ─────────────────────────────────────────────────────────────
# WRITING POSTURE
# ─────────────────────────────────────────────────────────────

def writing_posture(rows: list[ChainRow]) -> str:
    """
    Who is writing more — call writers or put writers?

    Call writing dominant → market expects a ceiling (bearish posture)
    Put writing dominant  → market expects a floor  (bullish posture)

    Methodology: sum of positive OI changes per side.
    """
    ce_writing = sum(
        r.oi_change for r in rows
        if r.opt_type == "CE" and r.oi_change > 0
    )
    pe_writing = sum(
        r.oi_change for r in rows
        if r.opt_type == "PE" and r.oi_change > 0
    )

    if ce_writing == 0 and pe_writing == 0:
        return "BALANCED"

    ratio = ce_writing / (pe_writing + 1)

    if ratio > 1.3:
        return "CALL_WRITERS_DOMINANT"
    elif ratio < 0.77:
        return "PUT_WRITERS_DOMINANT"
    return "BALANCED"


# ─────────────────────────────────────────────────────────────
# TREND STRENGTH  (ADX-inspired)
# ─────────────────────────────────────────────────────────────

def trend_strength(closes: list[float], period: int = 14) -> float:
    """
    Directional strength score 0–100 (ADX-style).
    Returns 0.0 if not enough data points.
    Higher = stronger trend in either direction.
    """
    if len(closes) < period + 1:
        return 0.0

    dm_plus, dm_minus, tr_list = [], [], []

    for i in range(1, len(closes)):
        up = closes[i] - closes[i - 1]
        dn = closes[i - 1] - closes[i]
        dm_plus.append(max(up, 0) if up > dn else 0)
        dm_minus.append(max(dn, 0) if dn > up else 0)
        tr_list.append(abs(closes[i] - closes[i - 1]))

    def smooth(series: list[float], n: int) -> list[float]:
        if len(series) < n:
            return series
        result = [sum(series[:n]) / n]
        for v in series[n:]:
            result.append(result[-1] - result[-1] / n + v)
        return result

    n = min(period, len(dm_plus))
    s_dmp = smooth(dm_plus, n)
    s_dmm = smooth(dm_minus, n)
    s_tr  = smooth(tr_list, n)

    dx_list = []
    for p, m, t in zip(s_dmp, s_dmm, s_tr):
        if t == 0:
            continue
        di_p = 100 * p / t
        di_m = 100 * m / t
        if di_p + di_m == 0:
            continue
        dx_list.append(100 * abs(di_p - di_m) / (di_p + di_m))

    if not dx_list:
        return 0.0

    adx = sum(dx_list[-period:]) / min(period, len(dx_list))
    return round(min(adx, 100.0), 2)


# ─────────────────────────────────────────────────────────────
# AVERAGE TRUE RANGE  (real volatility for stop/target sizing)
# ─────────────────────────────────────────────────────────────

def true_range(high: float, low: float, prev_close: float) -> float:
    """
    Single-bar True Range = max of:
        high − low
        |high − prev_close|
        |low  − prev_close|
    Captures gaps that a plain high−low range misses.
    """
    return max(
        high - low,
        abs(high - prev_close),
        abs(low - prev_close),
    )


def atr(candles: list[dict], period: int = 20) -> Optional[float]:
    """
    Average True Range over `period` bars, in price points.

    `candles` is a chronological list (oldest→newest) of dicts with
    `high`, `low`, `close` keys (e.g. daily OHLC from the history feed).
    The first bar seeds prev_close, so we need period+1 bars for a full
    window. Returns None when there isn't enough data — callers must then
    fall back rather than fabricate a value.
    """
    if not candles or len(candles) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(candles)):
        try:
            h = float(candles[i]["high"])
            lo = float(candles[i]["low"])
            pc = float(candles[i - 1]["close"])
        except (KeyError, TypeError, ValueError):
            continue
        trs.append(true_range(h, lo, pc))
    if len(trs) < period:
        return None
    return round(sum(trs[-period:]) / period, 2)


def realized_vol(candles: list[dict], period: int = 20) -> Optional[float]:
    """
    Annualised realised volatility (decimal, e.g. 0.13 = 13%) from the
    stdev of daily log returns over `period` bars. Comparable to India VIX
    once multiplied by 100. Returns None on insufficient data.
    """
    if not candles or len(candles) < period + 1:
        return None
    closes = [float(c["close"]) for c in candles if c.get("close")]
    if len(closes) < period + 1:
        return None
    rets: list[float] = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0:
            rets.append(math.log(closes[i] / closes[i - 1]))
    window = rets[-period:]
    if len(window) < 2:
        return None
    mean = sum(window) / len(window)
    var = sum((r - mean) ** 2 for r in window) / (len(window) - 1)
    return round(math.sqrt(var) * math.sqrt(252.0), 4)