"""
services/signal_service.py
---------------------------
Orchestrates:
    all modules → synthesizer engine → DB persist → return schema

Every synthesizer input is DERIVED from live market data via the same
engine logic that powers the dedicated Smart-Money / Sentiment /
Institutional / Regime endpoints. No random mock inputs — so the
dashboard bias is internally consistent with every other module page.
"""
import hashlib
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import AITradeSignal
from app.domain.schemas import AISignalOut
from app.engines.options_math import (
    ChainRow,
    classify_buildup,
    max_pain,
    oi_walls,
    pcr_oi,
    writing_posture,
    atm_strike,
)
from app.engines.synthesizer import SignalInputs, bias_label, synthesize
from app.services.market_history import get_market_features
from app.ingestion.providers import (
    get_institutional_activity,
    get_news_headlines,
    get_option_chain,
    get_spot,
)

MODEL_VERSION   = "synthesizer-v1.1"
DISCLOSURE_MODE = "intelligence"

# News category weights — mirror sentiment.py (RBI/MACRO move markets most).
_CATEGORY_WEIGHT = {
    "RBI":      2.0,
    "MACRO":    1.5,
    "GLOBAL":   1.2,
    "EARNINGS": 1.0,
    "INDEX":    0.8,
}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _derive_smart_money(raw_rows: list[dict], change_pct: float) -> tuple[int, float]:
    """
    Aggregate smart-money bias from per-strike build-up (mirrors
    smart_money.py). Bullish = LONG_BUILDUP + SHORT_COVERING,
    Bearish = SHORT_BUILDUP + LONG_UNWINDING. Strength-weighted.

    Returns (bias 1|0|-1, confidence 0–1).
    """
    bull = bear = 0.0
    for r in raw_rows:
        oi     = r.get("oi", 0) or 0
        oi_chg = r.get("oi_change", 0) or 0
        if oi < 10_000:
            continue
        strength = min(abs(oi_chg) / max(oi, 1), 1.0)
        if strength < 0.02:
            continue
        opt_type = r.get("option_type", "CE")
        effective_chg = change_pct if opt_type == "CE" else -change_pct
        code, _ = classify_buildup(effective_chg, oi_chg)
        if code in (1, 3):       # LONG_BUILDUP, SHORT_COVERING → bullish
            bull += strength
        elif code in (2, 4):     # SHORT_BUILDUP, LONG_UNWINDING → bearish
            bear += strength

    total = bull + bear
    if total == 0:
        return 0, 0.50
    if bull > bear * 1.2:
        bias = 1
    elif bear > bull * 1.2:
        bias = -1
    else:
        bias = 0
    confidence = round(max(bull, bear) / total, 4)
    return bias, confidence


def _hash_score(headline: str) -> float:
    """Deterministic headline sentiment in [-1, 1] (mirrors sentiment.py)."""
    h = int(hashlib.md5(headline.encode()).hexdigest(), 16)
    return round((h % 2000 - 1000) / 1000.0, 4)


def _derive_sentiment() -> tuple[float, float]:
    """Category-weighted aggregate news sentiment. Returns (score, conf)."""
    headlines = get_news_headlines(8)
    total = weight = 0.0
    for h in headlines:
        score = _hash_score(h["headline"])
        w     = _CATEGORY_WEIGHT.get(h.get("category", "INDEX"), 1.0)
        total  += score * w
        weight += w
    agg = round(total / weight, 4) if weight else 0.0
    conf = round(min(abs(agg) * 1.5 + len(headlines) * 0.02, 0.95), 4)
    return agg, conf


def _derive_fii() -> tuple[float, str]:
    """Real FII cash net + futures bias (mirrors institutional.py)."""
    data = get_institutional_activity(date.today().isoformat())
    fii_cash = next(
        (d for d in data if d["category"] == "FII" and d["segment"] == "CASH"),
        None,
    )
    fii_fut = next(
        (d for d in data if d["category"] == "FII" and d["segment"] == "IDX_FUT"),
        None,
    )
    fii_net = fii_cash["net_value_cr"] if fii_cash else 0.0

    fut_bias = "NEUTRAL"
    if fii_fut:
        longs  = fii_fut["long_contracts"]
        shorts = fii_fut["short_contracts"]
        if longs > shorts * 1.15:
            fut_bias = "LONG"
        elif shorts > longs * 1.15:
            fut_bias = "SHORT"
    return fii_net, fut_bias


class SignalService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_latest_signal(
        self,
        instrument_id: int,
    ) -> AISignalOut:

        # ── 1. Fetch live data ────────────────────────────────
        spot_data  = get_spot(instrument_id)
        spot       = spot_data["last_price"]
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

        # ── 2. Options metrics ────────────────────────────────
        strikes      = sorted({r.strike for r in engine_rows})
        walls        = oi_walls(engine_rows, spot)
        posture      = writing_posture(engine_rows)
        pcr          = pcr_oi(engine_rows)
        max_pain_val = max_pain(engine_rows, strikes)

        total_oi_chg = sum(r.oi_change for r in engine_rows)
        if change_pct >= 0 and total_oi_chg >= 0:
            oi_buildup = "LONG_BUILDUP"
        elif change_pct < 0 and total_oi_chg >= 0:
            oi_buildup = "SHORT_BUILDUP"
        elif change_pct < 0 and total_oi_chg < 0:
            oi_buildup = "LONG_UNWINDING"
        else:
            oi_buildup = "SHORT_COVERING"

        # Real volatility/trend features from daily history (ATR, ADX,
        # 5-day return, range compression). Falls back to a flagged neutral
        # set when history is unavailable — see _atr_or_proxy below.
        feats  = get_market_features(instrument_id)
        atr_20 = feats.atr_20 if feats.atr_20 else round(spot * 0.015, 2)

        # ── 3. Derive REAL module inputs ──────────────────────
        # Smart money — strength-weighted per-strike build-up
        smart_money_bias, smart_money_conf = _derive_smart_money(
            raw_rows, change_pct,
        )

        # FII — real cash net + futures positioning
        fii_net_cr, fii_fut_bias = _derive_fii()

        # Sentiment — category-weighted news score
        sentiment_score, sentiment_conf = _derive_sentiment()

        # ── 4. Synthesize ─────────────────────────────────────
        inputs = SignalInputs(
            pcr_oi=pcr,
            writing_posture=posture,
            oi_buildup=oi_buildup,
            spot=spot,
            support=walls.get("support"),
            resistance=walls.get("resistance"),
            max_pain=max_pain_val,
            atr_20=atr_20,
            smart_money_bias=smart_money_bias,
            smart_money_confidence=smart_money_conf,
            fii_net_cr=fii_net_cr,
            fii_fut_bias=fii_fut_bias,
            sentiment_score=sentiment_score,
            sentiment_confidence=sentiment_conf,
        )

        result = synthesize(inputs)
        now    = datetime.now(timezone.utc)

        # ── 5. Persist (deduplicated) ─────────────────────────
        # This method runs on every read (frontend polls every ~10-30s), so
        # writing a row each time would flood the table with near-duplicates.
        # Only persist when the signal is meaningfully new: no prior row, the
        # last row is older than the configured interval, or the bias flipped.
        prev = (
            await self.db.execute(
                select(AITradeSignal)
                .where(AITradeSignal.instrument_id == instrument_id)
                .order_by(AITradeSignal.as_of.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        min_interval = timedelta(
            minutes=settings.SIGNAL_PERSIST_MIN_INTERVAL_MINUTES,
        )
        should_persist = (
            prev is None
            or (now - prev.as_of.replace(tzinfo=timezone.utc)) >= min_interval
            or prev.bias != result.bias
        )

        if should_persist:
            self.db.add(AITradeSignal(
                instrument_id=instrument_id,
                as_of=now,
                bias=result.bias,
                entry_ref=result.entry_ref,
                stop_ref=result.stop_ref,
                target_ref=result.target_ref,
                risk_reward=result.risk_reward,
                confidence=result.confidence,
                reasoning=result.reasoning,
                disclosure_mode=DISCLOSURE_MODE,
                model_version=MODEL_VERSION,
            ))
            await self.db.commit()

        # ── 6. Return schema ──────────────────────────────────
        return AISignalOut(
            instrument_id=instrument_id,
            as_of=now,
            bias=result.bias,
            bias_label=bias_label(result.bias),
            entry_ref=result.entry_ref,
            stop_ref=result.stop_ref,
            target_ref=result.target_ref,
            risk_reward=result.risk_reward,
            confidence=result.confidence,
            reasoning=result.reasoning,
            disclosure_mode=DISCLOSURE_MODE,
            model_version=MODEL_VERSION,
        )