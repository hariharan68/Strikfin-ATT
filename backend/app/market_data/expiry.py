"""
app/market_data/expiry.py
-------------------------
Generic per-instrument expiry engine — replaces the hardcoded last-Thursday
futures-symbol builder in fyers_provider.

An instrument's `expiry_rule` (from the Instrument Master) names how its
derivatives expire; this module turns that rule + "now" into the current-month
contract code and, with the instrument's vendor futures template, the concrete
vendor futures symbol.

Rule vocabulary (extend as new markets are added):
    MONTHLY_LAST_THU  — monthly, last Thursday   (NIFTY futures today)
    MONTHLY_LAST_TUE  — monthly, last Tuesday    (SENSEX real-world)
    MONTHLY_LAST_WED  — monthly, last Wednesday
    MONTHLY_LAST_DAY  — monthly, last calendar day (e.g. some MCX)
"""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timezone
from typing import Optional

# rule → weekday index (Mon=0 … Sun=6); None = last calendar day
_RULE_WEEKDAY: dict[str, Optional[int]] = {
    "MONTHLY_LAST_THU": 3,
    "MONTHLY_LAST_TUE": 1,
    "MONTHLY_LAST_WED": 2,
    "MONTHLY_LAST_MON": 0,
    "MONTHLY_LAST_FRI": 4,
    "MONTHLY_LAST_DAY": None,
}

_DEFAULT_RULE = "MONTHLY_LAST_THU"


def _last_weekday(year: int, month: int, weekday: Optional[int]) -> int:
    _, days_in_month = monthrange(year, month)
    if weekday is None:
        return days_in_month
    for d in range(days_in_month, 0, -1):
        if datetime(year, month, d).weekday() == weekday:
            return d
    return days_in_month


def current_futures_month(expiry_rule: Optional[str], now: Optional[datetime] = None) -> tuple[str, str]:
    """Return ``(yy, MON)`` for the current-month futures contract, rolling to
    next month once this month's expiry has passed.

    e.g. ("26", "JUL"). `yy` is the 2-digit year, `MON` the upper-case month
    abbreviation — matching the vendor futures templates (NSE:NIFTY{yy}{mon}FUT).
    """
    now = now or datetime.now(timezone.utc)
    year, month = now.year, now.month
    weekday = _RULE_WEEKDAY.get((expiry_rule or _DEFAULT_RULE).upper(), 3)

    expiry_day = _last_weekday(year, month, weekday)
    if now.day > expiry_day:
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1

    return str(year)[2:], datetime(year, month, 1).strftime("%b").upper()


def build_futures_symbol(ref, vendor: str = "fyers", now: Optional[datetime] = None) -> Optional[str]:
    """Build the vendor current-month futures symbol for an InstrumentRef.

    Reads the instrument's `vendor_symbols[vendor]["futures_template"]` (e.g.
    "NSE:NIFTY{yy}{mon}FUT") and fills it from the expiry rule. Returns None if
    the instrument has no futures template (e.g. a cash equity).
    """
    if ref is None:
        return None
    template = ref.vendor_symbol(vendor, "futures_template")
    if not template:
        return None
    yy, mon = current_futures_month(ref.expiry_rule, now)
    try:
        return template.format(yy=yy, mon=mon)
    except (KeyError, IndexError):
        return None


def build_fyers_futures_symbol(ref, now: Optional[datetime] = None) -> Optional[str]:
    """Convenience wrapper for the Fyers vendor."""
    return build_futures_symbol(ref, vendor="fyers", now=now)
