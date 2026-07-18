"""Tests for the generic expiry engine (app/market_data/expiry.py).

Covers the OPTION-expiry cadence added for the instrument master
(`upcoming_option_expiries`: WEEKLY_* vs MONTHLY_LAST_*) and a regression on
the existing FUTURES month roll (`current_futures_month`).
"""
from datetime import date, datetime, timezone

from app.market_data.expiry import current_futures_month, upcoming_option_expiries


class TestWeeklyRules:
    def test_weekly_tue_emits_next_tuesdays(self):
        # Fri 2026-07-17 → next Tuesdays are 21, 28 Jul, 4 Aug.
        out = upcoming_option_expiries("WEEKLY_TUE", n=3, today=date(2026, 7, 17))
        assert out == [date(2026, 7, 21), date(2026, 7, 28), date(2026, 8, 4)]

    def test_expiry_day_itself_counts(self):
        # Tue 2026-07-21 IS an expiry day — it still trades, so it leads.
        out = upcoming_option_expiries("WEEKLY_TUE", n=2, today=date(2026, 7, 21))
        assert out == [date(2026, 7, 21), date(2026, 7, 28)]

    def test_weekly_thu(self):
        out = upcoming_option_expiries("WEEKLY_THU", n=2, today=date(2026, 7, 17))
        assert out == [date(2026, 7, 23), date(2026, 7, 30)]


class TestMonthlyRules:
    def test_monthly_last_thu_current_month_pending(self):
        # Last Thursdays: 30 Jul, 27 Aug 2026.
        out = upcoming_option_expiries("MONTHLY_LAST_THU", n=2, today=date(2026, 7, 17))
        assert out == [date(2026, 7, 30), date(2026, 8, 27)]

    def test_monthly_rolls_past_elapsed_expiry(self):
        # 31 Jul is after the last Thursday (30 Jul) → first emit is August.
        out = upcoming_option_expiries("MONTHLY_LAST_THU", n=1, today=date(2026, 7, 31))
        assert out == [date(2026, 8, 27)]

    def test_unknown_rule_defaults_to_monthly_last_thu(self):
        assert upcoming_option_expiries("BOGUS_RULE", n=1, today=date(2026, 7, 17)) == [
            date(2026, 7, 30)
        ]
        assert upcoming_option_expiries(None, n=1, today=date(2026, 7, 17)) == [
            date(2026, 7, 30)
        ]


class TestFuturesMonthRegression:
    def test_current_month_before_expiry(self):
        yy, mon = current_futures_month(
            "MONTHLY_LAST_THU", now=datetime(2026, 7, 17, tzinfo=timezone.utc)
        )
        assert (yy, mon) == ("26", "JUL")

    def test_rolls_to_next_month_after_expiry(self):
        # Last Thursday of July 2026 is the 30th; the 31st rolls to AUG.
        yy, mon = current_futures_month(
            "MONTHLY_LAST_THU", now=datetime(2026, 7, 31, tzinfo=timezone.utc)
        )
        assert (yy, mon) == ("26", "AUG")

    def test_december_rolls_to_next_year(self):
        # Last Thursday of Dec 2027 is the 30th → the 31st rolls to JAN '28.
        yy, mon = current_futures_month(
            "MONTHLY_LAST_THU", now=datetime(2027, 12, 31, tzinfo=timezone.utc)
        )
        assert (yy, mon) == ("28", "JAN")
