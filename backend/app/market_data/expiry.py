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
    MONTHLY_LAST_THU  — monthly, last Thursday   (NIFTY futures, BANKNIFTY options)
    MONTHLY_LAST_TUE  — monthly, last Tuesday    (SENSEX real-world)
    MONTHLY_LAST_WED  — monthly, last Wednesday
    MONTHLY_LAST_DAY  — monthly, last calendar day (e.g. some MCX)
    WEEKLY_MON..WEEKLY_FRI — weekly on that weekday (NIFTY/SENSEX index OPTIONS)

`upcoming_option_expiries` interprets an instrument's `option_expiry_rule`
(weekly or monthly cadence) into concrete upcoming expiry dates — the master-
driven replacement for the frontend's hardcoded "next Tuesday" builders.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
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

# WEEKLY_<DAY> → weekday index (Mon=0 … Fri=4) for option-expiry cadence.
_WEEKLY_WEEKDAY: dict[str, int] = {
    "WEEKLY_MON": 0,
    "WEEKLY_TUE": 1,
    "WEEKLY_WED": 2,
    "WEEKLY_THU": 3,
    "WEEKLY_FRI": 4,
}


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


def upcoming_option_expiries(
    option_expiry_rule: Optional[str],
    n: int = 6,
    today: Optional[date] = None,
) -> list[date]:
    """Next `n` OPTION expiry dates for a cadence rule, starting today-or-later.

    WEEKLY_<DAY> emits the next n occurrences of that weekday (today counts when
    it IS that weekday — expiry day itself still trades). MONTHLY_LAST_<DAY>
    emits the next n month-end weekdays, rolling past an already-elapsed one.
    Unknown/None rules default to WEEKLY_TUE-style behavior only if explicitly
    weekly-shaped; otherwise the monthly default rule applies.
    """
    today = today or datetime.now(timezone.utc).date()
    rule = (option_expiry_rule or _DEFAULT_RULE).upper()
    out: list[date] = []

    weekly_wd = _WEEKLY_WEEKDAY.get(rule)
    if weekly_wd is not None:
        d = today + timedelta(days=(weekly_wd - today.weekday()) % 7)
        for _ in range(n):
            out.append(d)
            d += timedelta(days=7)
        return out

    # Monthly cadence (MONTHLY_LAST_* / unknown → default monthly rule).
    weekday = _RULE_WEEKDAY.get(rule, _RULE_WEEKDAY[_DEFAULT_RULE])
    year, month = today.year, today.month
    while len(out) < n:
        d = date(year, month, _last_weekday(year, month, weekday))
        if d >= today:
            out.append(d)
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return out


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
