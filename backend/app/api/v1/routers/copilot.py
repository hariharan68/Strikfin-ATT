"""
api/v1/routers/copilot.py
--------------------------
POST /api/v1/copilot/ask
AI copilot grounded in live platform data.
Answers market questions — never gives personalized advice.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.config import settings
from app.core.deps import CurrentUserId, DBSession
from app.domain.schemas import CopilotRequest, CopilotResponse
from app.engines.options_math import ChainRow, oi_walls, pcr_oi
from app.ingestion.providers import get_news_headlines, get_option_chain, get_spot
from app.services.signal_service import SignalService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["copilot"])

# ─────────────────────────────────────────────────────────────
# SYSTEM PROMPT
# ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """
You are Strikfin — an institutional-grade market intelligence copilot
for NIFTY 50 and SENSEX analytics.

STRICT RULES — never violate these:
1. Answer ONLY from the market context data provided to you.
   Do NOT hallucinate market predictions or invent numbers.
2. Cite the specific numbers from the context when making any claim.
3. NEVER give personalized buy/sell advice, entry/exit calls,
   position sizing, or execution recommendations.
4. If asked for personalized advice, respond:
   "I can share intelligence from the data — not personalized advice.
    Please consult a SEBI-registered Research Analyst."
5. Always state confidence level in your assessment.
6. Keep answers concise — 3 to 5 sentences maximum.
7. End every response with:
   "This is AI-generated market intelligence, not investment advice."

You have access to: PCR, OI walls, AI bias,
FII/DII flows, sentiment scores, and recent headlines.
""".strip()


# ─────────────────────────────────────────────────────────────
# CONTEXT BUILDER
# ─────────────────────────────────────────────────────────────

async def _build_context(
    db,
    instrument_id: int,
) -> dict:
    """
    Assembles live market context for LLM grounding.
    This is what gets injected into the prompt as facts.
    """
    inst_id = instrument_id or 1

    spot_data  = get_spot(inst_id)
    spot       = spot_data["last_price"]
    change_pct = spot_data.get("change_pct", 0.0) or 0.0

    chain_data = get_option_chain(inst_id)
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
        for r in chain_data["rows"]
    ]

    walls = oi_walls(engine_rows, spot)
    pcr   = pcr_oi(engine_rows)

    signal_svc = SignalService(db)
    signal = await signal_svc.get_latest_signal(inst_id)

    headlines = get_news_headlines(5)

    return {
        "instrument":       "NIFTY50" if inst_id == 1 else "SENSEX",
        "spot":             spot,
        "change_pct":       change_pct,
        "india_vix":        spot_data.get("india_vix"),
        "pcr_oi":           pcr,
        "support":          walls.get("support"),
        "resistance":       walls.get("resistance"),
        "ai_bias":          signal.bias_label,
        "ai_confidence":    signal.confidence,
        "ai_reasoning":     signal.reasoning,
        "recent_headlines": [h["headline"] for h in headlines[:3]],
    }


# ─────────────────────────────────────────────────────────────
# RULE-BASED FALLBACK
# ─────────────────────────────────────────────────────────────

def _rule_based_answer(question: str, ctx: dict) -> str:
    """
    Structured rule-based response when LLM is not configured.
    Covers the most common question types.
    Always grounded in context — never invents numbers.
    """
    q = question.lower()

    DISCLOSURE = (
        "This is AI-generated market intelligence, not investment advice."
    )

    # ── Bias / direction ──────────────────────────────────────
    if any(w in q for w in ["bullish", "bearish", "bias", "direction", "outlook"]):
        return (
            f"{ctx['instrument']} is showing a **{ctx['ai_bias']}** bias "
            f"with {ctx['ai_confidence']:.0%} confidence. "
            f"PCR at {ctx['pcr_oi']:.2f}. "
            f"{DISCLOSURE}"
        )

    # ── Support / resistance ──────────────────────────────────
    if any(w in q for w in ["support", "resistance", "level", "zone", "wall"]):
        return (
            f"{ctx['instrument']} OI-derived support is at "
            f"**{ctx['support']}** and resistance at "
            f"**{ctx['resistance']}**. "
            f"Spot is currently at {ctx['spot']}. "
            f"These zones are based on peak OI concentration "
            f"and are probabilistic — not guaranteed levels. "
            f"{DISCLOSURE}"
        )

    # ── PCR ───────────────────────────────────────────────────
    if any(w in q for w in ["pcr", "put call", "put-call", "ratio"]):
        pcr = ctx["pcr_oi"]
        if pcr > 1.2:
            read = "elevated — aggressive hedging or bullish put-writing activity"
        elif pcr < 0.8:
            read = "low — call-heavy market, bullish speculation or bearish call-writing"
        else:
            read = "in neutral range"
        return (
            f"Current PCR (OI) for {ctx['instrument']} is **{pcr:.2f}** — {read}. "
            f"{DISCLOSURE}"
        )

    # ── VIX / volatility ──────────────────────────────────────
    if any(w in q for w in ["vix", "volatility", "fear"]):
        vix = ctx.get("india_vix", "N/A")
        read = (
            "elevated — market is pricing in uncertainty"
            if isinstance(vix, float) and vix > 18
            else "within normal range — market is relatively calm"
        )
        return (
            f"India VIX is at **{vix}** — {read}. "
            f"VIX above 20 signals elevated anxiety. "
            f"Below 14 signals compressed volatility. "
            f"{DISCLOSURE}"
        )

    # ── News / sentiment ──────────────────────────────────────
    if any(w in q for w in ["news", "headline", "sentiment", "macro"]):
        headlines = "\n• ".join(ctx.get("recent_headlines", []))
        return (
            f"Recent key headlines:\n• {headlines}\n"
            f"For scored sentiment analysis use the /sentiment endpoint. "
            f"{DISCLOSURE}"
        )

    # ── Default snapshot ──────────────────────────────────────
    return (
        f"{ctx['instrument']} snapshot — "
        f"Spot: {ctx['spot']} | "
        f"Change: {ctx['change_pct']:+.2f}% | "
        f"Bias: **{ctx['ai_bias']}** ({ctx['ai_confidence']:.0%}) | "
        f"PCR: {ctx['pcr_oi']:.2f} | "
        f"VIX: {ctx.get('india_vix', 'N/A')} | "
        f"Support: {ctx['support']} | "
        f"Resistance: {ctx['resistance']}. "
        f"Ask me about levels, PCR, VIX, bias or news. "
        f"{DISCLOSURE}"
    )


# ─────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────

@router.post("/ask", response_model=CopilotResponse)
async def ask_copilot(
    body: CopilotRequest,
    db: DBSession,
    _uid: CurrentUserId,
):
    """
    AI copilot — answers market questions grounded in live data.
    """
    inst_id = body.instrument_id or 1
    ctx     = await _build_context(db, inst_id)
    answer  = ""

    sources = [
        "Live spot & options data",
        "AI signal synthesizer (synthesizer-v1.0)",
        "News sentiment feed",
    ]

    # ── OpenAI ────────────────────────────────────────────────
    if settings.LLM_PROVIDER == "openai" and settings.OPENAI_API_KEY:
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            resp   = await client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=300,
                temperature=0.3,
                messages=[
                    {
                        "role":    "system",
                        "content": _SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Market context:\n"
                            f"{json.dumps(ctx, indent=2)}\n\n"
                            f"Question: {body.question}"
                        ),
                    },
                ],
            )
            answer = resp.choices[0].message.content or ""
            sources.append("OpenAI gpt-4o-mini")
        except Exception as e:
            logger.error(f"OpenAI call failed: {e}")
            answer = _rule_based_answer(body.question, ctx)
            sources.append("Rule-based fallback (LLM unavailable)")

    # ── Anthropic ─────────────────────────────────────────────
    elif settings.LLM_PROVIDER == "anthropic" and settings.ANTHROPIC_API_KEY:
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(
                api_key=settings.ANTHROPIC_API_KEY
            )
            resp = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                system=_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Market context:\n"
                            f"{json.dumps(ctx, indent=2)}\n\n"
                            f"Question: {body.question}"
                        ),
                    }
                ],
            )
            answer = resp.content[0].text if resp.content else ""
            sources.append("Anthropic claude-sonnet-4-6")
        except Exception as e:
            logger.error(f"Anthropic call failed: {e}")
            answer = _rule_based_answer(body.question, ctx)
            sources.append("Rule-based fallback (LLM unavailable)")

    # ── Rule-based fallback (default) ─────────────────────────
    else:
        answer = _rule_based_answer(body.question, ctx)

    return CopilotResponse(
        answer=answer,
        sources=sources,
        confidence=ctx.get("ai_confidence") or 0.60,
    )
