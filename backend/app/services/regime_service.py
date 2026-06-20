"""
services/regime_service.py
---------------------------
Orchestrates:
    mock_provider → regime engine → DB persist → return schema
"""
import json
import random
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MarketRegime
from app.domain.schemas import RegimeRead
from app.engines.options_math import ChainRow, pcr_oi, writing_posture
from app.engines.regime import RegimeFeatures, classify_regime, regime_label
from app.ingestion.providers import get_option_chain, get_spot

MODEL_VERSION = "rule-based-v1.0"


class RegimeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_current_regime(
        self,
        instrument_id: int,
    ) -> RegimeRead:
        """
        1. Fetch live spot + chain
        2. Build RegimeFeatures
        3. Run classify_regime engine
        4. Persist to DB
        5. Return RegimeRead schema
        """

        # ── 1. Fetch live data ────────────────────────────────
        spot_data  = get_spot(instrument_id)
        change_pct = spot_data.get("change_pct", 0.0) or 0.0
        vix        = spot_data.get("india_vix", 14.5) or 14.5

        chain_data = get_option_chain(instrument_id)
        raw_rows   = chain_data["rows"]

        engine_rows = [
            ChainRow(
                strike=r["strike"],
                opt_type=r["option_type"],
                oi=r.get("oi", 0) or 0,
                oi_change=r.get("oi_change", 0) or 0,
                ltp=r.get("ltp", 0.0) or 0.0,
                volume=r.get("volume", 0) or 0,
                price_change=change_pct,
            )
            for r in raw_rows
        ]

        # ── 2. Build features ─────────────────────────────────
        total_oi_chg = sum(r.oi_change for r in engine_rows)

        # Aggregate buildup from index-level price + net OI change
        if change_pct >= 0 and total_oi_chg >= 0:
            oi_buildup = "LONG_BUILDUP"
        elif change_pct < 0 and total_oi_chg >= 0:
            oi_buildup = "SHORT_BUILDUP"
        elif change_pct < 0 and total_oi_chg < 0:
            oi_buildup = "LONG_UNWINDING"
        else:
            oi_buildup = "SHORT_COVERING"

        pcr      = pcr_oi(engine_rows)
        posture  = writing_posture(engine_rows)

        # VIX percentile — mock (real: compare against 52-week range)
        vix_pct = min(max((vix - 10.0) / 20.0, 0.0), 1.0)

        # FII mock values (real: from institutional_service)
        fii_net      = random.uniform(-3_000, 3_000)
        fii_fut_bias = random.choice(["LONG", "SHORT", "NEUTRAL"])

        features = RegimeFeatures(
            return_1d=change_pct,
            return_5d=change_pct * random.uniform(2.0, 4.0),
            trend_strength=random.uniform(15.0, 45.0),
            range_compression=random.uniform(0.70, 1.30),
            india_vix=vix,
            vix_percentile=vix_pct,
            realized_vol_pct=vix_pct * 0.9,
            pcr_oi=pcr,
            oi_buildup=oi_buildup,
            writing_posture=posture,
            spot_vs_max_pain=0.0,
            fii_cash_net_cr=fii_net,
            fii_fut_bias=fii_fut_bias,
        )

        # ── 3. Classify ───────────────────────────────────────
        regime_code, confidence, evidence = classify_regime(features)
        label = regime_label(regime_code)
        now   = datetime.now(timezone.utc)

        # ── 4. Persist ────────────────────────────────────────
        self.db.add(MarketRegime(
            instrument_id=instrument_id,
            as_of=now,
            regime=regime_code,
            confidence=confidence,
            model_version=MODEL_VERSION,
            features=json.dumps(evidence),
        ))
        await self.db.commit()

        # ── 5. Return schema ──────────────────────────────────
        return RegimeRead(
            instrument_id=instrument_id,
            as_of=now,
            regime=regime_code,
            regime_label=label,
            confidence=confidence,
            top_features=evidence,
            model_version=MODEL_VERSION,
        )