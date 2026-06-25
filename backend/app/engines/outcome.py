"""
engines/outcome.py
------------------
Pure signal-outcome evaluation. Given a signal's entry/stop/target and the
price path that followed, decide whether it was a WIN, LOSS, or EXPIRED, and
the realised R multiple. Zero DB / IO — fully unit-testable.

This is the scoring core behind the accuracy scorecard: you can only make
trades more accurate once you can measure which signals actually worked.
"""
from dataclasses import dataclass
from typing import Optional

# Outcome status codes
OPEN       = "OPEN"        # horizon not elapsed yet
WIN        = "WIN"         # target reached before stop
LOSS       = "LOSS"        # stop reached before target
EXPIRED    = "EXPIRED"     # neither hit within horizon → settled at last price
NEUTRAL    = "NEUTRAL"     # neutral-bias signal (not directionally scored)


@dataclass
class OutcomeResult:
    status:      str
    exit_price:  Optional[float]
    realized_r:  Optional[float]   # R multiple (reward/risk units), signed
    bars_held:   int


def _realized_r(bias: int, entry: float, stop: float, exit_price: float) -> Optional[float]:
    """R multiple: profit in units of initial risk (entry→stop distance)."""
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    pnl = (exit_price - entry) if bias == 1 else (entry - exit_price)
    return round(pnl / risk, 3)


def evaluate_path(
    bias: int,
    entry: Optional[float],
    stop: Optional[float],
    target: Optional[float],
    bars: list[dict],
    horizon_elapsed: bool,
) -> OutcomeResult:
    """
    Walk the post-entry price path (chronological list of {high, low, close})
    and classify the outcome.

    Rules:
      • Long (bias=1):  stop if low ≤ stop, target if high ≥ target.
      • Short (bias=-1): stop if high ≥ stop, target if low ≤ target.
      • If a bar touches BOTH stop and target, assume STOP first (conservative).
      • Neither hit: OPEN until the horizon elapses, then EXPIRED settled at the
        last close.
      • Neutral bias or missing levels → NEUTRAL (not directionally scored).
    """
    if bias == 0 or entry is None or stop is None or target is None:
        return OutcomeResult(NEUTRAL, None, None, len(bars))

    for i, bar in enumerate(bars, start=1):
        hi = bar.get("high")
        lo = bar.get("low")
        if hi is None or lo is None:
            continue
        if bias == 1:
            hit_stop   = lo <= stop
            hit_target = hi >= target
        else:
            hit_stop   = hi >= stop
            hit_target = lo <= target
        if hit_stop:  # conservative: stop wins a same-bar tie
            return OutcomeResult(LOSS, stop, _realized_r(bias, entry, stop, stop), i)
        if hit_target:
            return OutcomeResult(WIN, target, _realized_r(bias, entry, stop, target), i)

    # Neither level hit across the available path.
    if not horizon_elapsed:
        return OutcomeResult(OPEN, None, None, len(bars))
    last_close = bars[-1].get("close") if bars else None
    if last_close is None:
        return OutcomeResult(OPEN, None, None, len(bars))
    return OutcomeResult(EXPIRED, last_close, _realized_r(bias, entry, stop, last_close), len(bars))
