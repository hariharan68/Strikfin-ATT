"""
api/v1/routers/sentiment.py
----------------------------
GET /api/v1/sentiment/{instrument_id}
"""
import hashlib
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Path

from app.core.deps import CurrentUserId
from app.ingestion.providers import get_news_headlines

router = APIRouter(prefix="/sentiment", tags=["sentiment"])


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _mock_score(headline: str) -> float:
    """
    Deterministic mock sentiment score derived from headline hash.
    Same headline always returns the same score.
    In production this is replaced by FinBERT inference.
    """
    h   = int(hashlib.md5(headline.encode()).hexdigest(), 16)
    raw = (h % 2000 - 1000) / 1000.0   # range -1.0 to 1.0
    return round(raw, 4)


def _label(score: float) -> str:
    if score > 0.15:
        return "BULLISH"
    elif score < -0.15:
        return "BEARISH"
    return "NEUTRAL"


def _category_weight(category: str) -> float:
    """
    High-impact categories get elevated weight in the aggregate.
    RBI and MACRO events move markets more than general INDEX news.
    """
    return {
        "RBI":      2.0,
        "MACRO":    1.5,
        "GLOBAL":   1.2,
        "EARNINGS": 1.0,
        "INDEX":    0.8,
    }.get(category, 1.0)


# ─────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────

@router.get("/{instrument_id}")
async def sentiment(
    instrument_id: int = Path(..., ge=1, le=2),
    _uid: CurrentUserId = None,
):
    """
    News sentiment score for NIFTY / SENSEX.

    Pipeline (production):
        1. Ingest headlines from NewsAPI / RSS feeds
        2. Dedupe via SHA-256 of normalised headline
        3. Score with FinBERT (fast, cheap, ~0.85 accuracy)
        4. Escalate ambiguous / high-impact items to LLM
        5. Aggregate with category weights
        6. Return scored headlines + aggregate

    Aggregate score:
        Weighted mean of individual scores.
        Range: -1.0 (very bearish) to +1.0 (very bullish)
        Confidence: derived from score magnitude + headline count

    Category weights:
        RBI      2.0  — highest market impact
        MACRO    1.5
        GLOBAL   1.2
        EARNINGS 1.0
        INDEX    0.8

    Note:
        Sentiment is general market commentary only.
        NOT investment advice.
        AI usage disclosed per SEBI guidelines.
    """

    # ── Fetch headlines ───────────────────────────────────────
    headlines = get_news_headlines(8)

    # ── Score each headline ───────────────────────────────────
    scored      = []
    total_score = 0.0
    total_weight = 0.0

    for h in headlines:
        score    = _mock_score(h["headline"])
        weight   = _category_weight(h.get("category", "INDEX"))
        label    = _label(score)

        total_score  += score * weight
        total_weight += weight

        scored.append({
            "headline":        h["headline"],
            "source":          h["source"],
            "category":        h.get("category", "INDEX"),
            "published_at":    h.get("published_at"),
            "sentiment_score": score,
            "label":           label,
            "weight":          weight,
        })

    # ── Aggregate ─────────────────────────────────────────────
    agg_score = round(
        total_score / total_weight if total_weight > 0 else 0.0,
        4,
    )
    agg_label = _label(agg_score)

    # Confidence rises with score magnitude and headline count
    confidence = round(
        min(abs(agg_score) * 1.5 + len(scored) * 0.02, 0.95),
        4,
    )

    # Top drivers — headlines with highest absolute score
    sorted_by_impact = sorted(
        scored,
        key=lambda x: abs(x["sentiment_score"]),
        reverse=True,
    )
    top_drivers = [s["headline"][:100] for s in sorted_by_impact[:3]]

    # ── Build response ────────────────────────────────────────
    return {
        "instrument_id":   instrument_id,
        "as_of":           datetime.now(timezone.utc).isoformat(),
        "aggregate_score": agg_score,
        "label":           agg_label,
        "confidence":      confidence,
        "headline_count":  len(scored),
        "top_drivers":     top_drivers,
        "scored_headlines": scored,
        "model":           "mock-md5 (FinBERT in production)",
        "note": (
            "Sentiment is general market commentary only. "
            "NOT investment advice. "
            "AI usage disclosed per SEBI guidelines."
        ),
    }