"""
services/options_lab_service.py
-------------------------------
Powers the Options Lab → Open Interest tool.

Provides an *intraday* OI view per strike:
    OI at market open (≈09:15)  →  OI now  →  the change between them.

Data sourcing (in priority order):
  1. INTRADAY  — ≥2 option-chain snapshots exist for the latest trade date.
       open = earliest snapshot's OI, now = latest snapshot's OI. This is the
       true intraday build-up the reference UI shows.
  2. PROXY     — only one snapshot today. The provider's `oi_change` is the
       day-over-day change, so open ≈ now_oi − oi_change.
  3. LIVE      — no snapshots in the DB at all. Take one live chain call and
       apply the same proxy.

The scheduler (ingestion/scheduler.py) persists a snapshot every ~5 min during
market hours, so case (1) becomes the norm once a session has been running.
"""
import logging
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# India Standard Time — fixed UTC+5:30 (India observes no DST). A fixed offset is
# used rather than ZoneInfo("Asia/Kolkata") because the IANA tz database is not
# bundled on Windows, where ZoneInfo would silently fail. Mirrors dashboard.py.
_IST = timezone(timedelta(hours=5, minutes=30))

from app.db.models import OptionChainRow, OptionChainSnapshot
from app.engines.options_math import (
    ChainRow,
    LOT_SIZE,
    atm_strike,
    max_pain,
    pcr_oi,
)
from app.ingestion.providers import get_option_chain, get_spot

logger = logging.getLogger(__name__)

_SYMBOLS = {1: "NIFTY 50", 2: "SENSEX"}
_MARKET_OPEN = time(9, 15)


def _f(v) -> float:
    """Coerce Decimal/None to float."""
    return float(v) if v is not None else 0.0


def _i(v) -> int:
    return int(v) if v is not None else 0


class OptionsLabService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ─────────────────────────────────────────────────────────
    # PUBLIC
    # ─────────────────────────────────────────────────────────

    async def get_oi_view(self, instrument_id: int) -> dict:
        """
        Returns the intraday Open-Interest view for the Open Interest tool.
        Never raises for "no data" — degrades to the live/proxy path.
        """
        now_rows, open_rows, now_ts, open_ts, quality = await self._resolve_series(
            instrument_id
        )

        if not now_rows:
            # Absolute last resort — return an empty but well-formed payload.
            return self._empty_payload(instrument_id)

        # Build per-strike open/now maps keyed by (strike, type).
        def index(rows: list[dict]) -> dict[tuple[float, str], dict]:
            return {(r["strike"], r["option_type"]): r for r in rows}

        now_idx = index(now_rows)
        open_idx = index(open_rows) if open_rows else {}

        strikes = sorted({r["strike"] for r in now_rows})

        # Spot + ATM + max pain from the *now* snapshot.
        spot = self._spot_for(instrument_id, now_rows)
        engine_now = self._to_engine(now_rows)
        atm = atm_strike(spot, strikes) if strikes else spot
        mp = max_pain(engine_now, strikes) if strikes else atm
        pcr_now = pcr_oi(engine_now)
        pcr_open = pcr_oi(self._to_engine(open_rows)) if open_rows else pcr_now

        out_strikes = []
        tot_call_now = tot_put_now = 0
        tot_call_open = tot_put_open = 0

        for s in strikes:
            ce_now = now_idx.get((s, "CE"))
            pe_now = now_idx.get((s, "PE"))
            ce_open = open_idx.get((s, "CE"))
            pe_open = open_idx.get((s, "PE"))

            call_now = _i(ce_now and ce_now.get("oi"))
            put_now = _i(pe_now and pe_now.get("oi"))

            # Open OI: true earlier snapshot when we have it, else day-over-day proxy.
            if quality == "intraday":
                call_open = _i(ce_open and ce_open.get("oi"))
                put_open = _i(pe_open and pe_open.get("oi"))
            else:
                call_open = call_now - _i(ce_now and ce_now.get("oi_change"))
                put_open = put_now - _i(pe_now and pe_now.get("oi_change"))

            call_chg = call_now - call_open
            put_chg = put_now - put_open

            tot_call_now += call_now
            tot_put_now += put_now
            tot_call_open += call_open
            tot_put_open += put_open

            out_strikes.append({
                "strike":            s,
                "call_oi_open":      call_open,
                "call_oi_now":       call_now,
                "call_oi_chg":       call_chg,
                "call_oi_chg_pct":   round(call_chg / call_open * 100, 2) if call_open else 0.0,
                "put_oi_open":       put_open,
                "put_oi_now":        put_now,
                "put_oi_chg":        put_chg,
                "put_oi_chg_pct":    round(put_chg / put_open * 100, 2) if put_open else 0.0,
            })

        sentiment = self._sentiment(
            pcr_now, tot_call_now - tot_call_open, tot_put_now - tot_put_open
        )

        return {
            "instrument_id":      instrument_id,
            "symbol":             _SYMBOLS.get(instrument_id, "NIFTY 50"),
            "spot":               round(spot, 2),
            "atm_strike":         atm,
            "max_pain":           mp,
            "lot_size":           LOT_SIZE.get(instrument_id, 75),
            "pcr_oi":             pcr_now,
            "pcr_change":         round(pcr_now - pcr_open, 2),
            "open_ts":            open_ts,
            "now_ts":             now_ts,
            "data_quality":       quality,
            "total_call_oi":      tot_call_now,
            "total_put_oi":       tot_put_now,
            "total_call_oi_chg":  tot_call_now - tot_call_open,
            "total_put_oi_chg":   tot_put_now - tot_put_open,
            "sentiment":          sentiment,
            "strikes":            out_strikes,
        }

    # ─────────────────────────────────────────────────────────
    # SERIES RESOLUTION
    # ─────────────────────────────────────────────────────────

    async def _resolve_series(self, instrument_id: int):
        """
        Returns (now_rows, open_rows, now_ts_iso, open_ts_iso, quality).
        now_rows/open_rows are lists of {strike, option_type, oi, oi_change}.
        """
        # Latest snapshot for this instrument.
        latest = (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(OptionChainSnapshot.instrument_id == instrument_id)
                .order_by(OptionChainSnapshot.snap_ts.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if latest is None:
            # No DB history yet → one live chain call (proxy baseline).
            return self._live_proxy(instrument_id)

        # Earliest snapshot at/after 09:15 IST on the latest trade date.
        earliest = await self._earliest_after_open(instrument_id, latest)

        now_rows = await self._rows_for(latest.snapshot_id)
        now_ts = latest.snap_ts.replace(tzinfo=timezone.utc).isoformat()

        if earliest is not None and earliest.snapshot_id != latest.snapshot_id:
            open_rows = await self._rows_for(earliest.snapshot_id)
            open_ts = earliest.snap_ts.replace(tzinfo=timezone.utc).isoformat()
            return now_rows, open_rows, now_ts, open_ts, "intraday"

        # Only one post-open snapshot today → proxy from day-over-day oi_change.
        open_ts = self._market_open_iso(latest.trade_date)
        return now_rows, [], now_ts, open_ts, "live_proxy"

    async def _earliest_after_open(self, instrument_id: int, latest):
        """
        First snapshot at/after 09:15 IST on the latest trade date. Pre-market
        snapshots carry stale/zero OI and would corrupt the open baseline.
        """
        # snap_ts is stored as naive UTC — compare against a naive UTC instant.
        market_open = self._market_open_dt(latest.trade_date).replace(tzinfo=None)
        return (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(
                    OptionChainSnapshot.instrument_id == instrument_id,
                    OptionChainSnapshot.trade_date == latest.trade_date,
                    OptionChainSnapshot.snap_ts >= market_open,
                )
                .order_by(OptionChainSnapshot.snap_ts.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _rows_for(self, snapshot_id: int) -> list[dict]:
        rows = (
            await self.db.execute(
                select(OptionChainRow).where(OptionChainRow.snapshot_id == snapshot_id)
            )
        ).scalars().all()
        return [
            {
                "strike":      _f(r.strike),
                "option_type": r.option_type,
                "oi":          _i(r.oi),
                "oi_change":   _i(r.oi_change),
            }
            for r in rows
        ]

    def _live_proxy(self, instrument_id: int):
        """No DB history — fetch one live chain and use day-over-day proxy."""
        chain = get_option_chain(instrument_id)
        rows = [
            {
                "strike":      _f(r["strike"]),
                "option_type": r["option_type"],
                "oi":          _i(r.get("oi")),
                "oi_change":   _i(r.get("oi_change")),
            }
            for r in chain.get("rows", [])
        ]
        now_ts = datetime.now(timezone.utc).isoformat()
        open_ts = self._market_open_iso(datetime.now(_IST).date())
        return rows, [], now_ts, open_ts, "live_proxy"

    # ─────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────

    def _to_engine(self, rows: list[dict]) -> list[ChainRow]:
        return [
            ChainRow(
                strike=r["strike"],
                opt_type=r["option_type"],
                oi=_i(r.get("oi")),
                oi_change=_i(r.get("oi_change")),
                ltp=0.0,
                volume=0,
                price_change=0.0,
            )
            for r in rows
        ]

    def _spot_for(self, instrument_id: int, now_rows: list[dict]) -> float:
        """Live spot; falls back to ATM-ish midpoint of strikes if unavailable."""
        try:
            s = get_spot(instrument_id)
            spot = float(s.get("last_price") or 0)
            if spot > 0:
                return spot
        except Exception:
            logger.warning("spot fetch failed for OI view", exc_info=True)
        strikes = sorted({r["strike"] for r in now_rows})
        return strikes[len(strikes) // 2] if strikes else 0.0

    def _market_open_dt(self, trade_date) -> datetime:
        """09:15 IST on trade_date, as a tz-aware UTC datetime."""
        return datetime.combine(trade_date, _MARKET_OPEN, tzinfo=_IST).astimezone(timezone.utc)

    def _market_open_iso(self, trade_date) -> str:
        return self._market_open_dt(trade_date).isoformat()

    def _sentiment(self, pcr: float, call_chg: int, put_chg: int) -> dict:
        """
        Bullish/bearish read from PCR + OI-flow skew.
        Put writing (PE OI↑) defends downside → bullish.
        Call writing (CE OI↑) caps upside → bearish.
        """
        pcr_comp = max(0.0, min(1.0, (pcr - 0.7) / 0.8))  # 0.7→0, 1.5→1
        denom = abs(call_chg) + abs(put_chg) + 1
        flow = (put_chg - call_chg) / denom            # -1..1
        flow01 = (flow + 1) / 2
        bullish = round(100 * (0.5 * pcr_comp + 0.5 * flow01))
        bullish = max(0, min(100, bullish))

        if bullish >= 60:
            label = "Bullish"
        elif bullish <= 40:
            label = "Bearish"
        else:
            label = "Neutral"

        insight = f"Market displaying {label.lower()} sentiment with " + (
            "positive indicators." if label == "Bullish"
            else "cautious indicators." if label == "Bearish"
            else "mixed indicators."
        )

        def _compact(n: int) -> str:
            a = abs(n)
            if a >= 1e7:
                return f"{n / 1e7:.2f}Cr"
            if a >= 1e5:
                return f"{n / 1e5:.2f}L"
            return str(n)

        if put_chg > call_chg:
            flow_txt = (
                f"Strong put accumulation ({'+' if put_chg >= 0 else ''}{_compact(put_chg)}) "
                f"vs calls ({_compact(call_chg)}) indicates defensive/bullish positioning."
            )
        else:
            flow_txt = (
                f"Call writing ({'+' if call_chg >= 0 else ''}{_compact(call_chg)}) "
                f"outpaces puts ({_compact(put_chg)}) — upside looks capped."
            )
        analysis = f"PCR at {pcr:.2f}. {flow_txt}"

        return {
            "label":       label,
            "bullish_pct": bullish,
            "insight":     insight,
            "analysis":    analysis,
        }

    def _empty_payload(self, instrument_id: int) -> dict:
        return {
            "instrument_id":     instrument_id,
            "symbol":            _SYMBOLS.get(instrument_id, "NIFTY 50"),
            "spot":              0.0,
            "atm_strike":        0.0,
            "max_pain":          0.0,
            "lot_size":          LOT_SIZE.get(instrument_id, 75),
            "pcr_oi":            0.0,
            "pcr_change":        0.0,
            "open_ts":           None,
            "now_ts":            datetime.now(timezone.utc).isoformat(),
            "data_quality":      "empty",
            "total_call_oi":     0,
            "total_put_oi":      0,
            "total_call_oi_chg": 0,
            "total_put_oi_chg":  0,
            "sentiment":         {"label": "Neutral", "bullish_pct": 50,
                                  "insight": "Awaiting market data.", "analysis": ""},
            "strikes":           [],
        }
