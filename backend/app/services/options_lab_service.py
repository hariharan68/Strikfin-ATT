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
_MARKET_CLOSE = time(15, 30)


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

        # Per-snapshot Call/Put OI for the interactive time-range slider. Aligned
        # to `strikes` order so the client can recompute the open→now build-up for
        # any selected (open, now) pair of points. Empty when <2 snapshots exist.
        oi_series = await self._intraday_oi_series(instrument_id, strikes)

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
            "series":             oi_series,
        }

    async def get_oi_series(self, instrument_id: int, window: int = 20) -> dict:
        """
        Intraday *time-series* of OI / Volume / OI-change per strike, used by the
        Options Lab → Multi OI & Volume tool.

        Walks every option-chain snapshot at/after 09:15 IST on the latest trade
        date and returns, for a window of strikes around ATM:
          • ``contracts`` — the selectable CE/PE legs in the window.
          • ``default_ids`` — the highest-OI legs (the "High OI" default selection).
          • ``series`` — one entry per snapshot, with the future price and arrays
            of oi / volume / oi_change aligned to ``contracts``.

        Degrades gracefully: a single snapshot yields a one-point series
        (``data_quality = "live_proxy"``); no data yields an empty series.
        """
        snaps = await self._day_snapshots(instrument_id)

        if not snaps:
            # No DB history — fall back to one live chain as a single point.
            return self._live_series(instrument_id, window)

        latest = snaps[-1]
        # The first snapshot *after* 15:30 IST holds the official close (the
        # provider returns the frozen EOD chain after market hours). We append it
        # as a single closing point so the chart reaches market end even when
        # intraday ingestion stopped early — without dragging the full, flat
        # after-hours tail onto the chart.
        close_snap = await self._close_snapshot(instrument_id, latest.trade_date)

        # Bulk-load rows for every snapshot in one query, then reuse the latest
        # snapshot's rows here instead of issuing a second query for them.
        snap_ids = [s.snapshot_id for s in snaps]
        if close_snap is not None:
            snap_ids.append(close_snap.snapshot_id)
        rows_by_snap = await self._rows_by_snapshot(snap_ids, with_vol=True)
        latest_rows = rows_by_snap.get(latest.snapshot_id, [])
        if not latest_rows:
            return self._live_series(instrument_id, window)

        strikes = sorted({r["strike"] for r in latest_rows})
        spot = self._spot_for(instrument_id, latest_rows)
        atm = atm_strike(spot, strikes) if strikes else spot

        # Strike window around ATM keeps the payload lean while covering the
        # high-OI strikes the tool actually plots.
        atm_i = min(range(len(strikes)), key=lambda i: abs(strikes[i] - atm)) if strikes else 0
        lo_i = max(0, atm_i - window)
        hi_i = min(len(strikes), atm_i + window + 1)
        win_strikes = strikes[lo_i:hi_i]

        # Stable contract list (strike asc, CE before PE) — only legs present now.
        latest_idx = {(r["strike"], r["option_type"]): r for r in latest_rows}
        contracts: list[dict] = []
        for s in win_strikes:
            for opt in ("CE", "PE"):
                if (s, opt) in latest_idx:
                    contracts.append({
                        "id":     f"{int(s)}{opt}",
                        "strike": s,
                        "type":   opt,
                    })
        key_of = {(c["strike"], c["type"]): i for i, c in enumerate(contracts)}

        # "High OI" default — the N highest-OI legs in the window (mixed CE/PE).
        ranked = sorted(
            contracts,
            key=lambda c: _i(latest_idx[(c["strike"], c["type"])].get("oi")),
            reverse=True,
        )
        default_ids = [c["id"] for c in ranked[:5]]
        # "High Volume" default — the N highest-volume legs in the window.
        ranked_vol = sorted(
            contracts,
            key=lambda c: _i(latest_idx[(c["strike"], c["type"])].get("volume")),
            reverse=True,
        )
        default_vol_ids = [c["id"] for c in ranked_vol[:5]]

        # Build aligned per-point arrays from the already-loaded snapshot rows.
        n = len(contracts)
        series: list[dict] = []
        for snap in snaps:
            idx = {(r["strike"], r["option_type"]): r
                   for r in rows_by_snap.get(snap.snapshot_id, [])}
            oi = [None] * n
            vol = [None] * n
            chg = [None] * n
            for (strike, opt), r in idx.items():
                i = key_of.get((strike, opt))
                if i is None:
                    continue
                oi[i] = _i(r.get("oi"))
                vol[i] = _i(r.get("volume"))
                chg[i] = _i(r.get("oi_change"))
            series.append({
                "t":   snap.snap_ts.replace(tzinfo=timezone.utc).isoformat(),
                "fut": _f(snap.spot),
                "oi":  oi,
                "vol": vol,
                "chg": chg,
            })

        # Append the official close as a final point anchored at 15:30 IST, so the
        # line extends to market end. Only when the close is genuinely after the
        # last intraday snapshot (i.e. intraday ingestion ended before the close).
        if close_snap is not None and snaps[-1].snap_ts < self._market_close_dt(latest.trade_date).replace(tzinfo=None):
            close_rows = rows_by_snap.get(close_snap.snapshot_id, [])
            if close_rows:
                cidx = {(r["strike"], r["option_type"]): r for r in close_rows}
                oi = [None] * n
                vol = [None] * n
                chg = [None] * n
                for (strike, opt), r in cidx.items():
                    i = key_of.get((strike, opt))
                    if i is None:
                        continue
                    oi[i] = _i(r.get("oi"))
                    vol[i] = _i(r.get("volume"))
                    chg[i] = _i(r.get("oi_change"))
                series.append({
                    "t":   self._market_close_dt(latest.trade_date).isoformat(),
                    "fut": _f(close_snap.spot),
                    "oi":  oi,
                    "vol": vol,
                    "chg": chg,
                })

        quality = "intraday" if len(series) >= 2 else "live_proxy"
        return {
            "instrument_id": instrument_id,
            "symbol":        _SYMBOLS.get(instrument_id, "NIFTY 50"),
            "lot_size":      LOT_SIZE.get(instrument_id, 75),
            "spot":          round(spot, 2),
            "atm_strike":    atm,
            "trade_date":    latest.trade_date.isoformat(),
            "open_ts":       series[0]["t"] if series else None,
            "now_ts":        series[-1]["t"] if series else None,
            "data_quality":  quality,
            "contracts":     contracts,
            "default_ids":   default_ids,
            "default_vol_ids": default_vol_ids,
            "series":        series,
        }

    # ─────────────────────────────────────────────────────────
    # SERIES RESOLUTION
    # ─────────────────────────────────────────────────────────

    def _market_close_dt(self, trade_date) -> datetime:
        """15:30 IST on trade_date, as a tz-aware UTC datetime."""
        return datetime.combine(trade_date, _MARKET_CLOSE, tzinfo=_IST).astimezone(timezone.utc)

    def _in_session(self, snap_ts: datetime) -> bool:
        """
        True if a snapshot falls within NSE/BSE cash hours (Mon–Fri 09:15–15:30
        IST). ``snap_ts`` is stored as naive UTC, so we attach UTC then convert.
        """
        ist = snap_ts.replace(tzinfo=timezone.utc).astimezone(_IST)
        if ist.weekday() >= 5:  # Sat/Sun
            return False
        return _MARKET_OPEN <= ist.time() <= _MARKET_CLOSE

    async def _latest_session_snapshot(self, instrument_id: int):
        """
        Most recent snapshot that falls *within* market hours.

        The scheduler can persist snapshots outside cash hours (after-hours and
        weekend polling when ``INGEST_MARKET_HOURS_ONLY`` is off). Anchoring the
        OI view to the raw latest snapshot then produces a meaningless evening
        window (e.g. 7:11pm → 10:21pm on a Saturday). Scanning newest-first for
        the first in-session snapshot instead anchors us to the last real trading
        session — exactly what the reference UI shows when the market is closed.

        Falls back to the latest snapshot if none in the recent window are in
        session (so the view still degrades gracefully rather than going blank).
        """
        # Fast path: during market hours the newest snapshot is already in
        # session — one cheap row, no wide scan.
        latest = (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(OptionChainSnapshot.instrument_id == instrument_id)
                .order_by(OptionChainSnapshot.snap_ts.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest is None or self._in_session(latest.snap_ts):
            return latest

        # Market closed — scan back for the last in-session snapshot.
        candidates = (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(OptionChainSnapshot.instrument_id == instrument_id)
                .order_by(OptionChainSnapshot.snap_ts.desc())
                .limit(3000)  # ~10 trading days of 5-min snapshots — covers long weekends/holidays
            )
        ).scalars().all()
        for snap in candidates:
            if self._in_session(snap.snap_ts):
                return snap
        return latest

    async def _close_snapshot(self, instrument_id: int, trade_date):
        """
        First snapshot after 15:30 IST on the trade date — the frozen EOD chain
        the provider serves once the market has closed (i.e. the official close).
        """
        market_close = self._market_close_dt(trade_date).replace(tzinfo=None)
        return (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(
                    OptionChainSnapshot.instrument_id == instrument_id,
                    OptionChainSnapshot.trade_date == trade_date,
                    OptionChainSnapshot.snap_ts > market_close,
                )
                .order_by(OptionChainSnapshot.snap_ts.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _day_snapshots(self, instrument_id: int):
        """
        All in-session snapshots (09:15–15:30 IST) on the latest *trading*
        session, ascending. Anchors to the last in-session snapshot, so on
        weekends/holidays/after-hours it returns the last real session rather
        than an empty set or a stale after-hours tail.
        """
        latest = await self._latest_session_snapshot(instrument_id)
        if latest is None:
            return []
        market_open = self._market_open_dt(latest.trade_date).replace(tzinfo=None)
        # Cap at 15:30 IST — the scheduler keeps ingesting after the close (its
        # market-hours gate runs in UTC on Windows), which would otherwise tack a
        # flat, stale-OI tail and bogus late-evening x-axis labels onto the chart.
        market_close = (
            datetime.combine(latest.trade_date, _MARKET_CLOSE, tzinfo=_IST)
            .astimezone(timezone.utc)
            .replace(tzinfo=None)
        )
        return (
            await self.db.execute(
                select(OptionChainSnapshot)
                .where(
                    OptionChainSnapshot.instrument_id == instrument_id,
                    OptionChainSnapshot.trade_date == latest.trade_date,
                    OptionChainSnapshot.snap_ts >= market_open,
                    OptionChainSnapshot.snap_ts <= market_close,
                )
                .order_by(OptionChainSnapshot.snap_ts.asc())
            )
        ).scalars().all()

    async def _intraday_oi_series(self, instrument_id: int, strike_axis: list[float]) -> list[dict]:
        """
        Call/Put OI at every in-session snapshot of the latest trading session,
        aligned to ``strike_axis`` (the strike order of the returned ``strikes``).

        Powers the Open Interest tool's interactive time-range slider: the client
        picks any (open, now) pair of points and recomputes the per-strike OI
        build-up locally. Returns ``[]`` when fewer than 2 snapshots exist (there
        is nothing to scrub — the static open→now view is used instead).
        """
        snaps = await self._day_snapshots(instrument_id)
        if len(snaps) < 2:
            return []
        axis = {s: i for i, s in enumerate(strike_axis)}
        n = len(strike_axis)

        # Append the official close (frozen EOD chain just after 15:30) as a final
        # point anchored at 15:30, so the slider reaches market end even when
        # intraday ingestion stopped early (e.g. the last live snapshot was 2:52pm).
        trade_date = snaps[-1].trade_date
        market_close = self._market_close_dt(trade_date).replace(tzinfo=None)
        close_snap = await self._close_snapshot(instrument_id, trade_date)
        append_close = close_snap is not None and snaps[-1].snap_ts < market_close

        snap_ids = [s.snapshot_id for s in snaps]
        if append_close:
            snap_ids.append(close_snap.snapshot_id)
        rows_by = await self._rows_by_snapshot(snap_ids)

        def _point(snapshot_id: int, t_iso: str) -> dict:
            call: list[int | None] = [None] * n
            put: list[int | None] = [None] * n
            for r in rows_by.get(snapshot_id, []):
                i = axis.get(r["strike"])
                if i is None:
                    continue
                if r["option_type"] == "CE":
                    call[i] = _i(r.get("oi"))
                else:
                    put[i] = _i(r.get("oi"))
            return {"t": t_iso, "call": call, "put": put}

        out: list[dict] = [
            _point(snap.snapshot_id, snap.snap_ts.replace(tzinfo=timezone.utc).isoformat())
            for snap in snaps
        ]
        if append_close:
            out.append(_point(close_snap.snapshot_id, self._market_close_dt(trade_date).isoformat()))
        return out

    async def _rows_by_snapshot(self, snapshot_ids: list[int], with_vol: bool = False):
        """Bulk-load OptionChainRows for many snapshots, grouped by snapshot_id."""
        if not snapshot_ids:
            return {}
        rows = (
            await self.db.execute(
                select(OptionChainRow).where(
                    OptionChainRow.snapshot_id.in_(snapshot_ids)
                )
            )
        ).scalars().all()
        out: dict[int, list[dict]] = {}
        for r in rows:
            d = {
                "strike":      _f(r.strike),
                "option_type": r.option_type,
                "oi":          _i(r.oi),
                "oi_change":   _i(r.oi_change),
            }
            if with_vol:
                d["volume"] = _i(r.volume)
            out.setdefault(r.snapshot_id, []).append(d)
        return out

    def _live_series(self, instrument_id: int, window: int) -> dict:
        """No DB history — one live chain rendered as a single series point."""
        chain = get_option_chain(instrument_id)
        rows = [
            {
                "strike":      _f(r["strike"]),
                "option_type": r["option_type"],
                "oi":          _i(r.get("oi")),
                "oi_change":   _i(r.get("oi_change")),
                "volume":      _i(r.get("volume")),
            }
            for r in chain.get("rows", [])
        ]
        if not rows:
            return {
                "instrument_id": instrument_id,
                "symbol":        _SYMBOLS.get(instrument_id, "NIFTY 50"),
                "lot_size":      LOT_SIZE.get(instrument_id, 75),
                "spot":          0.0,
                "atm_strike":    0.0,
                "trade_date":    datetime.now(_IST).date().isoformat(),
                "open_ts":       None,
                "now_ts":        datetime.now(timezone.utc).isoformat(),
                "data_quality":  "empty",
                "contracts":     [],
                "default_ids":   [],
                "default_vol_ids": [],
                "series":        [],
            }
        strikes = sorted({r["strike"] for r in rows})
        spot = self._spot_for(instrument_id, rows)
        atm = atm_strike(spot, strikes) if strikes else spot
        atm_i = min(range(len(strikes)), key=lambda i: abs(strikes[i] - atm))
        lo_i = max(0, atm_i - window)
        hi_i = min(len(strikes), atm_i + window + 1)
        win_strikes = strikes[lo_i:hi_i]
        idx = {(r["strike"], r["option_type"]): r for r in rows}

        contracts: list[dict] = []
        for s in win_strikes:
            for opt in ("CE", "PE"):
                if (s, opt) in idx:
                    contracts.append({"id": f"{int(s)}{opt}", "strike": s, "type": opt})

        oi = [_i(idx[(c["strike"], c["type"])].get("oi")) for c in contracts]
        vol = [_i(idx[(c["strike"], c["type"])].get("volume")) for c in contracts]
        chg = [_i(idx[(c["strike"], c["type"])].get("oi_change")) for c in contracts]
        ranked = sorted(contracts, key=lambda c: _i(idx[(c["strike"], c["type"])].get("oi")), reverse=True)
        ranked_vol = sorted(contracts, key=lambda c: _i(idx[(c["strike"], c["type"])].get("volume")), reverse=True)
        now_ts = datetime.now(timezone.utc).isoformat()

        return {
            "instrument_id": instrument_id,
            "symbol":        _SYMBOLS.get(instrument_id, "NIFTY 50"),
            "lot_size":      LOT_SIZE.get(instrument_id, 75),
            "spot":          round(spot, 2),
            "atm_strike":    atm,
            "trade_date":    datetime.now(_IST).date().isoformat(),
            "open_ts":       now_ts,
            "now_ts":        now_ts,
            "data_quality":  "live_proxy",
            "contracts":     contracts,
            "default_ids":   [c["id"] for c in ranked[:5]],
            "default_vol_ids": [c["id"] for c in ranked_vol[:5]],
            "series":        [{"t": now_ts, "fut": round(spot, 2), "oi": oi, "vol": vol, "chg": chg}],
        }

    async def _resolve_series(self, instrument_id: int):
        """
        Returns (now_rows, open_rows, now_ts_iso, open_ts_iso, quality).
        now_rows/open_rows are lists of {strike, option_type, oi, oi_change}.
        """
        # Anchor to the latest *in-session* snapshot. When the market is closed
        # (after-hours, weekend, holiday) the scheduler may still persist
        # out-of-session snapshots; anchoring to those shows a bogus late-evening
        # window. Falling back to the last real session makes the view read
        # 09:15 → 15:30 — what the reference UI shows when the market is closed.
        latest = await self._latest_session_snapshot(instrument_id)

        if latest is None:
            # No DB history yet → one live chain call (proxy baseline).
            return self._live_proxy(instrument_id)

        # Earliest snapshot at/after 09:15 IST on the session's trade date.
        earliest = await self._earliest_after_open(instrument_id, latest)

        # Prefer the official close (the frozen EOD chain captured just after
        # 15:30) as the "now" anchor, so the view reaches market end even when
        # intraday ingestion stopped early (e.g. the last live snapshot was 2:52pm).
        now_snap = latest
        now_ts = latest.snap_ts.replace(tzinfo=timezone.utc).isoformat()
        close_snap = await self._close_snapshot(instrument_id, latest.trade_date)
        if close_snap is not None and close_snap.snap_ts > latest.snap_ts:
            now_snap = close_snap
            now_ts = self._market_close_dt(latest.trade_date).isoformat()

        now_rows = await self._rows_for(now_snap.snapshot_id)

        if earliest is not None and earliest.snapshot_id != now_snap.snapshot_id:
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
