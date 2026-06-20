"""
engines/short_covering.py
--------------------------
Short Covering Rally Detection Engine.

Indian market pattern:
  - Market opens bearish and sells off from 9:15 AM
  - Post noon (12–2 PM) price starts recovering
  - Call writers (shorts) cover → Call OI drops
  - Volume spikes on futures as bears exit
  - Price bounces off key support level
  - Net result: sharp recovery that looks like green candle(s)

This engine scores 6 independent signals and returns a
confidence score (0–100) with a human-readable verdict.

Pure logic — zero DB, zero network, zero FastAPI.
All inputs are plain dicts returned by the providers.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# SIGNAL WEIGHTS  (must sum to 100)
# ─────────────────────────────────────────────────────────────
_W_CALL_OI_UNWIND  = 30   # Call OI declining (bears covering calls)
_W_DAY_LOW_RECOVER = 25   # Price recovered from day low
_W_BEARISH_OPEN    = 20   # Market actually fell from today's open
_W_VOLUME_SPIKE    = 15   # Futures volume above typical
_W_SUPPORT_BOUNCE  = 10   # Price near / at OI-derived support


# ─────────────────────────────────────────────────────────────
# THRESHOLDS
# ─────────────────────────────────────────────────────────────
_MIN_RECOVERY_PCT   = 30.0   # Must have recovered at least 30% of the day range
_MIN_BEARISH_PCT    = -0.10  # Open-to-now must be ≤ -0.10% to count as bearish
_SUPPORT_TOLERANCE  = 0.006  # Price within 0.6% of support counts as "near support"
_VOLUME_HIGH_THRESHOLD = 1_000_000   # futures volume above this = high
_VOLUME_VERY_HIGH      = 5_000_000   # above this = very high / spike

# Post-noon window: after 12:00 PM IST
_IST = timezone(timedelta(hours=5, minutes=30))
_POST_NOON_HOUR = 12


# ─────────────────────────────────────────────────────────────
# OUTPUT SCHEMA
# ─────────────────────────────────────────────────────────────

@dataclass
class SignalFactor:
    name:        str
    fired:       bool          # True = contributing to score
    value:       str           # human-readable measured value
    description: str           # what this means


@dataclass
class ShortCoveringResult:
    status:          str               # Watching / Early Signs / Possible Rally / Confirmed / Strong Signal
    score:           int               # 0–100
    confidence_pct:  int               # same as score for UI convenience
    is_post_noon:    bool              # time-window check
    factors:         list[SignalFactor] = field(default_factory=list)

    # Key raw metrics for the UI to display separately
    recovery_pct:    float = 0.0       # % recovery from day low
    call_oi_change:  int   = 0         # total CE OI change (negative = covering)
    put_oi_change:   int   = 0         # total PE OI change
    pcr:             float = 0.0       # put-call ratio
    support_level:   Optional[float] = None
    near_support:    bool  = False
    futures_volume:  int   = 0
    day_open:        float = 0.0
    day_low:         float = 0.0
    day_high:        float = 0.0
    ltp:             float = 0.0
    change_from_open_pct: float = 0.0  # (ltp - open) / open * 100

    verdict:         str   = ""        # plain-English summary


def _status_from_score(score: int) -> str:
    if score >= 85:
        return "Strong Signal"
    if score >= 70:
        return "Confirmed"
    if score >= 50:
        return "Possible Rally"
    if score >= 30:
        return "Early Signs"
    return "Watching"


# ─────────────────────────────────────────────────────────────
# MAIN DETECTION FUNCTION
# ─────────────────────────────────────────────────────────────

def detect_short_covering(
    spot: dict,
    chain: dict,
    futures: dict,
) -> ShortCoveringResult:
    """
    Detect a short covering rally for one instrument.

    Parameters
    ----------
    spot    : dict from get_spot()     — ltp, open_price, high_price, low_price, change_pct
    chain   : dict from get_option_chain() — rows[], total_call_oi, total_put_oi, pcr_oi
    futures : dict from get_futures()  — volume, last_price, change_pct

    Returns
    -------
    ShortCoveringResult with score, status, per-factor breakdown, and verdict.
    """

    # ── Unpack spot ──────────────────────────────────────────
    ltp        = float(spot.get("last_price", 0) or 0)
    open_price = float(spot.get("open_price",  0) or 0) or ltp
    high_price = float(spot.get("high_price",  0) or 0) or ltp
    low_price  = float(spot.get("low_price",   0) or 0) or ltp

    # ── Unpack chain ─────────────────────────────────────────
    rows           = chain.get("rows", [])
    total_call_oi  = int(chain.get("total_call_oi", 0) or 0)
    total_put_oi   = int(chain.get("total_put_oi",  0) or 0)
    pcr            = float(chain.get("pcr_oi", 1.0) or 1.0)
    support_level  = chain.get("support")   # may be None

    # ── OI changes ───────────────────────────────────────────
    call_oi_change = sum(int(r.get("oi_change", 0) or 0) for r in rows if r.get("option_type") == "CE")
    put_oi_change  = sum(int(r.get("oi_change", 0) or 0) for r in rows if r.get("option_type") == "PE")

    # ── Futures volume ───────────────────────────────────────
    fut_volume = int(futures.get("volume", 0) or 0)

    # ── Derived metrics ──────────────────────────────────────
    day_range = high_price - low_price
    recovery_pct = ((ltp - low_price) / day_range * 100) if day_range > 0 else 0.0
    change_from_open = ((ltp - open_price) / open_price * 100) if open_price > 0 else 0.0

    near_support = False
    if support_level and support_level > 0 and ltp > 0:
        near_support = abs(ltp - support_level) / ltp <= _SUPPORT_TOLERANCE

    # ── Time check ───────────────────────────────────────────
    now_ist    = datetime.now(_IST)
    is_post_noon = now_ist.hour >= _POST_NOON_HOUR

    # ─────────────────────────────────────────────────────────
    # SCORE EACH SIGNAL
    # ─────────────────────────────────────────────────────────
    factors: list[SignalFactor] = []
    score = 0

    # 1. Call OI Unwinding — bears covering their short calls
    if call_oi_change < 0:
        score += _W_CALL_OI_UNWIND
        intensity = "strong" if call_oi_change < -500_000 else "moderate" if call_oi_change < -100_000 else "mild"
        factors.append(SignalFactor(
            name="Call OI Unwinding",
            fired=True,
            value=f"{call_oi_change:+,}",
            description=f"Call OI declining ({intensity}) — short sellers covering positions",
        ))
    else:
        factors.append(SignalFactor(
            name="Call OI Unwinding",
            fired=False,
            value=f"{call_oi_change:+,}",
            description="Call OI still building — shorts not yet exiting",
        ))

    # 2. Day Low Recovery — price moved up from the intraday bottom
    if recovery_pct >= _MIN_RECOVERY_PCT:
        # Scale score: 30% recovery = partial, 60%+ = full weight
        partial = min(recovery_pct / 60.0, 1.0)
        pts = round(_W_DAY_LOW_RECOVER * partial)
        score += pts
        factors.append(SignalFactor(
            name="Day Low Recovery",
            fired=True,
            value=f"{recovery_pct:.1f}% of day range",
            description=f"Price recovered {recovery_pct:.1f}% from day low {low_price:.0f} toward high {high_price:.0f}",
        ))
    else:
        factors.append(SignalFactor(
            name="Day Low Recovery",
            fired=False,
            value=f"{recovery_pct:.1f}% of day range",
            description=f"Only {recovery_pct:.1f}% recovery from low — insufficient reversal yet",
        ))

    # 3. Bearish Open — market must have fallen from open first
    if change_from_open <= _MIN_BEARISH_PCT:
        score += _W_BEARISH_OPEN
        factors.append(SignalFactor(
            name="Bearish Open",
            fired=True,
            value=f"{change_from_open:+.2f}% from open",
            description=f"Market fell {abs(change_from_open):.2f}% from open {open_price:.0f} — short covering context valid",
        ))
    else:
        factors.append(SignalFactor(
            name="Bearish Open",
            fired=False,
            value=f"{change_from_open:+.2f}% from open",
            description="Market has not fallen significantly from open — short covering context weak",
        ))

    # 4. Volume Spike on Futures — surge in buying volume confirms bears exiting
    if fut_volume >= _VOLUME_VERY_HIGH:
        score += _W_VOLUME_SPIKE
        factors.append(SignalFactor(
            name="Volume Spike",
            fired=True,
            value=f"{_fmt_volume(fut_volume)}",
            description=f"Very high futures volume ({_fmt_volume(fut_volume)}) — strong buying participation",
        ))
    elif fut_volume >= _VOLUME_HIGH_THRESHOLD:
        pts = round(_W_VOLUME_SPIKE * 0.6)
        score += pts
        factors.append(SignalFactor(
            name="Volume Spike",
            fired=True,
            value=f"{_fmt_volume(fut_volume)}",
            description=f"Elevated futures volume ({_fmt_volume(fut_volume)}) — moderate buying activity",
        ))
    else:
        factors.append(SignalFactor(
            name="Volume Spike",
            fired=False,
            value=f"{_fmt_volume(fut_volume)}",
            description=f"Futures volume ({_fmt_volume(fut_volume)}) is normal — no surge yet",
        ))

    # 5. Support Bounce — price holding at OI-wall support
    if near_support and support_level:
        score += _W_SUPPORT_BOUNCE
        factors.append(SignalFactor(
            name="Support Bounce",
            fired=True,
            value=f"Near {support_level:.0f}",
            description=f"Price holding near OI support at {support_level:.0f} — key level acting as floor",
        ))
    else:
        lvl_str = f"{support_level:.0f}" if support_level else "N/A"
        factors.append(SignalFactor(
            name="Support Bounce",
            fired=False,
            value=f"Support @ {lvl_str}",
            description="Price not near key OI support level",
        ))

    # 6. Post-Noon Time Window — bonus context (no score, only description)
    factors.append(SignalFactor(
        name="Post-Noon Window",
        fired=is_post_noon,
        value=now_ist.strftime("%H:%M IST"),
        description=(
            f"Post-noon ({now_ist.strftime('%H:%M')} IST) — classic short covering window active"
            if is_post_noon
            else f"Pre-noon ({now_ist.strftime('%H:%M')} IST) — short covering patterns more reliable after 12:00"
        ),
    ))

    # Clamp score
    score = max(0, min(100, score))
    status = _status_from_score(score)

    # ─────────────────────────────────────────────────────────
    # VERDICT PARAGRAPH
    # ─────────────────────────────────────────────────────────
    verdict = _build_verdict(
        status=status,
        score=score,
        ltp=ltp,
        open_price=open_price,
        change_from_open=change_from_open,
        recovery_pct=recovery_pct,
        low_price=low_price,
        call_oi_change=call_oi_change,
        fut_volume=fut_volume,
        support_level=support_level,
        near_support=near_support,
        pcr=pcr,
        is_post_noon=is_post_noon,
        factors=factors,
    )

    logger.info(
        f"ShortCovering [{spot.get('symbol','?')}] "
        f"score={score} status={status!r} "
        f"callOI={call_oi_change:+,} recovery={recovery_pct:.1f}%"
    )

    return ShortCoveringResult(
        status=status,
        score=score,
        confidence_pct=score,
        is_post_noon=is_post_noon,
        factors=factors,
        recovery_pct=round(recovery_pct, 2),
        call_oi_change=call_oi_change,
        put_oi_change=put_oi_change,
        pcr=round(pcr, 3),
        support_level=support_level,
        near_support=near_support,
        futures_volume=fut_volume,
        day_open=open_price,
        day_low=low_price,
        day_high=high_price,
        ltp=ltp,
        change_from_open_pct=round(change_from_open, 3),
        verdict=verdict,
    )


# ─────────────────────────────────────────────────────────────
# VERDICT BUILDER
# ─────────────────────────────────────────────────────────────

def _build_verdict(
    status: str,
    score: int,
    ltp: float,
    open_price: float,
    change_from_open: float,
    recovery_pct: float,
    low_price: float,
    call_oi_change: int,
    fut_volume: int,
    support_level: Optional[float],
    near_support: bool,
    pcr: float,
    is_post_noon: bool,
    factors: list[SignalFactor],
) -> str:
    fired = [f for f in factors if f.fired]
    parts: list[str] = []

    # Context sentence
    if change_from_open <= -0.1:
        parts.append(
            f"Market fell {abs(change_from_open):.2f}% from open ({open_price:.0f}) to low ({low_price:.0f})."
        )
    else:
        parts.append(f"Market opened at {open_price:.0f}, currently at {ltp:.0f}.")

    # Recovery
    if recovery_pct >= 30:
        parts.append(
            f"Price has since recovered {recovery_pct:.1f}% of the day's range from the low."
        )

    # Call OI
    if call_oi_change < 0:
        parts.append(
            f"Call OI unwinding by {abs(call_oi_change):,} contracts — short sellers are exiting."
        )
    else:
        parts.append("Call OI is still building — shorts not yet covering.")

    # Volume
    if fut_volume >= _VOLUME_HIGH_THRESHOLD:
        parts.append(f"Futures volume at {_fmt_volume(fut_volume)} — buying is accelerating.")

    # Support
    if near_support and support_level:
        parts.append(f"Price is holding near key OI support at {support_level:.0f}.")

    # PCR comment
    if pcr > 1.1:
        parts.append(f"PCR at {pcr:.2f} — put-heavy market provides upside fuel.")
    elif pcr < 0.8:
        parts.append(f"PCR at {pcr:.2f} — call-heavy; recovery may face resistance.")

    # Time
    if not is_post_noon:
        parts.append("Note: patterns are stronger after 12:00 PM IST.")

    # Verdict conclusion
    if status == "Strong Signal":
        parts.append(f"All signals aligned. High probability short covering rally in progress (score {score}/100).")
    elif status == "Confirmed":
        parts.append(f"Strong evidence of short covering. Watch for continuation above resistance (score {score}/100).")
    elif status == "Possible Rally":
        parts.append(f"Short covering likely in progress. Monitor call OI and volume for confirmation (score {score}/100).")
    elif status == "Early Signs":
        parts.append(f"Early signs only. Wait for more signals to fire before acting (score {score}/100).")
    else:
        parts.append(f"No clear short covering pattern yet. Market needs to show more intent (score {score}/100).")

    return " ".join(parts)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _fmt_volume(v: int) -> str:
    if v >= 10_000_000:
        return f"{v / 10_000_000:.2f} Cr"
    if v >= 100_000:
        return f"{v / 100_000:.2f} L"
    if v >= 1_000:
        return f"{v / 1_000:.1f} K"
    return str(v)
