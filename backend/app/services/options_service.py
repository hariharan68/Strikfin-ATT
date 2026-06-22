"""
services/options_service.py
----------------------------
Orchestrates:
    mock_provider → engine computations → DB persist → return schema
"""
import logging
import traceback
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import OptionChainRow, OptionChainSnapshot
from app.domain.schemas import OptionsMetrics
from app.engines.options_math import (
    ChainRow,
    atm_iv,
    atm_strike,
    classify_buildup,
    iv_percentile,
    iv_percentile_label,
    max_pain,
    oi_walls,
    pcr_oi,
    pcr_volume,
    writing_posture,
)
from app.ingestion.providers import get_option_chain, get_spot

_IV_HISTORY_MIN = 20  # minimum snapshots needed for real percentile

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

async def _historical_iv_percentile(
    db: AsyncSession,
    instrument_id: int,
    current_iv: float,
) -> tuple[float | None, str | None]:
    """
    Compute IV percentile as the fraction of historical ATM IV snapshots
    that are <= current_iv. Uses the stored option_chain_rows joined to
    snapshots where the row's strike == the snapshot's ATM strike.

    Falls back to the proxy-band formula when fewer than _IV_HISTORY_MIN
    data points exist (e.g. first day after deployment).
    """
    try:
        # All historical ATM IVs for this instrument (CE + PE averaged per snap).
        stmt = (
            select(func.avg(OptionChainRow.iv).label("atm_iv"))
            .join(OptionChainSnapshot, OptionChainRow.snapshot_id == OptionChainSnapshot.snapshot_id)
            .where(
                OptionChainSnapshot.instrument_id == instrument_id,
                OptionChainRow.strike == OptionChainSnapshot.atm_strike,
                OptionChainRow.iv > 0,
            )
            .group_by(OptionChainSnapshot.snapshot_id)
        )
        result = await db.execute(stmt)
        history = [float(row.atm_iv) for row in result.fetchall()]

        if len(history) < _IV_HISTORY_MIN:
            pct = iv_percentile(current_iv)
            return pct, iv_percentile_label(pct)

        below = sum(1 for v in history if v <= current_iv)
        pct   = round(below / len(history) * 100.0, 2)
        return pct, iv_percentile_label(pct)

    except Exception:
        logger.warning("Historical IV percentile query failed; using proxy", exc_info=True)
        pct = iv_percentile(current_iv)
        return pct, iv_percentile_label(pct)


def _to_engine_rows(
    raw_rows: list[dict],
    price_change: float,
) -> list[ChainRow]:
    """Converts raw provider dicts into typed engine ChainRow objects."""
    return [
        ChainRow(
            strike=r["strike"],
            opt_type=r["option_type"],
            oi=r.get("oi", 0) or 0,
            oi_change=r.get("oi_change", 0) or 0,
            ltp=r.get("ltp", 0.0) or 0.0,
            volume=r.get("volume", 0) or 0,
            price_change=price_change,
            iv=r.get("iv"),
        )
        for r in raw_rows
    ]


# ─────────────────────────────────────────────────────────────
# SERVICE
# ─────────────────────────────────────────────────────────────

class OptionsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_latest_metrics(
        self,
        instrument_id: int,
    ) -> OptionsMetrics:
        try:
            return await self._get_latest_metrics(instrument_id)
        except Exception:
            logger.error(
                "get_latest_metrics failed for instrument %s\n%s",
                instrument_id, traceback.format_exc(),
            )
            raise

    async def _get_latest_metrics(
        self,
        instrument_id: int,
    ) -> OptionsMetrics:
        """
        1. Fetch spot + chain from provider
        2. Run all engine computations
        3. Persist snapshot to DB
        4. Return OptionsMetrics schema
        """

        # ── 1. Fetch data ─────────────────────────────────────
        spot_data  = get_spot(instrument_id)
        spot       = spot_data["last_price"]
        change_pct = spot_data.get("change_pct", 0.0) or 0.0

        chain_data = get_option_chain(instrument_id)
        raw_rows   = chain_data["rows"]

        # ── 2. Engine computations ────────────────────────────
        engine_rows = _to_engine_rows(raw_rows, change_pct)

        strikes        = sorted({r.strike for r in engine_rows})
        atm            = atm_strike(spot, strikes)
        pcr_oi_val     = pcr_oi(engine_rows)
        pcr_vol_val    = pcr_volume(engine_rows)
        max_pain_val   = max_pain(engine_rows, strikes)
        walls          = oi_walls(engine_rows, spot)
        posture        = writing_posture(engine_rows)
        atm_iv_val                = atm_iv(engine_rows, atm)
        iv_pct_val, iv_pct_label  = await _historical_iv_percentile(
            self.db, instrument_id, atm_iv_val
        ) if atm_iv_val is not None else (None, None)

        total_call = sum(r.oi for r in engine_rows if r.opt_type == "CE")
        total_put  = sum(r.oi for r in engine_rows if r.opt_type == "PE")

        # Per-row buildup classification
        classified_rows = []
        for r in raw_rows:
            code, label = classify_buildup(
                change_pct,
                r.get("oi_change", 0) or 0,
            )
            classified_rows.append({
                **r,
                "buildup_type":  code,
                "buildup_label": label,
            })

        # ── 3. Persist snapshot ───────────────────────────────
        now = datetime.now(timezone.utc)

        expiry_str = chain_data.get("expiry_date") or "2026-06-26"
        try:
            expiry_dt = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            expiry_dt = now.date()

        snapshot = OptionChainSnapshot(
            instrument_id=instrument_id,
            trade_date=now.date(),
            expiry_date=expiry_dt,
            snap_ts=now,
            spot=spot,
            atm_strike=atm,
            total_call_oi=total_call,
            total_put_oi=total_put,
            pcr_oi=pcr_oi_val,
            pcr_volume=pcr_vol_val,
            max_pain_strike=max_pain_val,
        )
        self.db.add(snapshot)
        await self.db.flush()  # get snapshot_id before rows

        for r in classified_rows:
            self.db.add(OptionChainRow(
                snapshot_id=snapshot.snapshot_id,
                trade_date=now.date(),
                strike=r["strike"],
                option_type=r["option_type"],
                ltp=r.get("ltp"),
                oi=r.get("oi"),
                oi_change=r.get("oi_change"),
                volume=r.get("volume"),
                iv=r.get("iv"),
                delta=r.get("delta"),
                theta=r.get("theta"),
                vega=r.get("vega"),
                gamma=r.get("gamma"),
                buildup_type=r.get("buildup_type"),
            ))

        await self.db.commit()

        # ── 4. Return schema ──────────────────────────────────
        return OptionsMetrics(
            instrument_id=instrument_id,
            snap_ts=now,
            spot=spot,
            atm_strike=atm,
            pcr_oi=pcr_oi_val,
            pcr_volume=pcr_vol_val,
            max_pain_strike=max_pain_val,
            support_strike=walls.get("support"),
            resistance_strike=walls.get("resistance"),
            total_call_oi=total_call,
            total_put_oi=total_put,
            writing_posture=posture,
            atm_iv=atm_iv_val,
            iv_percentile=iv_pct_val,
            iv_percentile_label=iv_pct_label,
        )

    async def get_chain_rows(
        self,
        instrument_id: int,
    ) -> dict:
        try:
            return await self._get_chain_rows(instrument_id)
        except Exception:
            logger.error(
                "get_chain_rows failed for instrument %s\n%s",
                instrument_id, traceback.format_exc(),
            )
            raise

    async def _get_chain_rows(
        self,
        instrument_id: int,
    ) -> dict:
        """
        Returns full chain with per-strike buildup labels.
        Used by the /options/{id}/chain endpoint.
        """
        spot_data  = get_spot(instrument_id)
        spot       = spot_data["last_price"]
        change_pct = spot_data.get("change_pct", 0.0) or 0.0

        chain_data = get_option_chain(instrument_id)
        raw_rows   = chain_data["rows"]

        classified = []
        for r in raw_rows:
            code, label = classify_buildup(
                change_pct,
                r.get("oi_change", 0) or 0,
            )
            classified.append({
                **r,
                "buildup_type":  code,
                "buildup_label": label,
            })

        return {
            "instrument_id": instrument_id,
            "spot":          spot,
            "atm_strike":    atm_strike(spot, sorted({r["strike"] for r in raw_rows})),
            "snap_ts":       datetime.now(timezone.utc).isoformat(),
            "expiry_date":   chain_data.get("expiry_date"),
            "chain_rows":    classified,
        }