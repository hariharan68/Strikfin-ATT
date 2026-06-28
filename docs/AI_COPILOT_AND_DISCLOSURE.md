# AI Copilot and Disclosure

## Overview

The AI Copilot (`POST /copilot/ask`) is a market Q&A assistant grounded exclusively in live platform data. It never speculates, invents numbers, or gives personalized investment advice.

---

## Grounding: What Context Gets Passed to the LLM

Before every LLM call (or rule-based fallback), the backend assembles a context object from live data:

```python
{
  "instrument":        "NIFTY50",          # or "SENSEX"
  "spot":              24350.5,
  "change_pct":        0.42,
  "india_vix":         14.2,
  "pcr_oi":            1.18,               # computed by options_math.pcr_oi()
  "support":           24200.0,            # computed by options_math.oi_walls()
  "resistance":        24500.0,
  "regime":            "Trend Up",         # from regime engine (rule-based-v1.0)
  "regime_confidence": 0.72,
  "ai_bias":           "Bullish",          # from synthesizer engine (synthesizer-v1.1)
  "ai_confidence":     0.68,
  "ai_reasoning":      "**Bullish** bias | confidence 68% | ...",
  "recent_headlines":  ["RBI holds rates...", "FII inflows surge...", "..."]
}
```

This context is the **only** source of market facts the LLM is allowed to use. The system prompt explicitly instructs the LLM to cite specific numbers from this context and not to invent data.

---

## LLM Provider Abstraction

The copilot supports three `LLM_PROVIDER` values, set in `.env`:

### `LLM_PROVIDER=openai`

Uses `openai.AsyncOpenAI` with model `gpt-4o-mini`:

```python
await client.chat.completions.create(
    model="gpt-4o-mini",
    max_tokens=300,
    temperature=0.3,
    messages=[
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user",   "content": f"Market context:\n{json.dumps(ctx)}\n\nQuestion: {question}"}
    ]
)
```

Requires `OPENAI_API_KEY` to be set.

### `LLM_PROVIDER=anthropic`

Uses `anthropic.AsyncAnthropic` with model `claude-sonnet-4-6`:

```python
await client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=300,
    system=_SYSTEM_PROMPT,
    messages=[{"role": "user", "content": f"Market context:\n{json.dumps(ctx)}\n\nQuestion: {question}"}]
)
```

Requires `ANTHROPIC_API_KEY` to be set.

### `LLM_PROVIDER=none` (default)

Uses a **rule-based structured fallback** — no external API call, no cost, no latency. Covers the most common question types:

| Question keywords | Response type |
|---|---|
| `bullish`, `bearish`, `bias`, `direction`, `outlook` | Bias + regime + PCR snapshot |
| `support`, `resistance`, `level`, `zone`, `wall` | OI-derived support/resistance with disclaimer |
| `pcr`, `put call`, `put-call`, `ratio` | PCR value with interpretation |
| `vix`, `volatility`, `fear` | VIX level with high/normal/low read |
| `regime`, `trend`, `sideways`, `breakout` | Regime label + confidence + reasoning |
| `news`, `headline`, `sentiment`, `macro` | Recent headlines list |
| (anything else) | Full market snapshot |

### Graceful Degradation

If `LLM_PROVIDER=openai` but the API call fails (network error, rate limit, etc.), the rule-based fallback is used automatically and the error is noted in the `sources` field of the response. The endpoint never returns a 500 due to an LLM provider failure.

---

## System Prompt

The system prompt injected into every LLM call enforces these hard rules:

1. Answer ONLY from the provided market context data. Do NOT hallucinate market predictions or invent numbers.
2. Cite specific numbers from the context when making any claim.
3. NEVER give personalized buy/sell advice, entry/exit calls, position sizing, or execution recommendations.
4. If asked for personalized advice, respond: *"I can share intelligence from the data — not personalized advice. Please consult a SEBI-registered Research Analyst."*
5. Always state confidence level in the assessment.
6. Keep answers concise — 3 to 5 sentences maximum.
7. End every response with: *"This is AI-generated market intelligence, not investment advice."*

---

## SEBI Compliance Mechanism

### `disclosure_mode` Field

Every AI-generated signal in the `ai_trade_signals` table carries a `disclosure_mode` column. The current codebase hardcodes this to `"intelligence"` — meaning all outputs are classified as market intelligence, not investment advice.

The constant is defined in `services/signal_service.py`:
```python
DISCLOSURE_MODE = "intelligence"
```

It is persisted to the DB on every signal write and returned in every `AISignalOut` response.

### Disclaimer — Always Present

Every endpoint that returns AI-computed outputs includes a `disclaimer` field:

```
"AI-generated intelligence only. NOT investment advice. 
AI usage disclosed per SEBI guidelines. 
Consult a SEBI-registered adviser before trading."
```

The dashboard endpoint adds a platform-level disclaimer:

```
"All outputs are AI-generated market intelligence for informational purposes only. 
NOT investment advice. AI usage disclosed per SEBI guidelines. 
Consult a SEBI-registered adviser before trading."
```

The copilot system prompt also ends every LLM response with:
```
"This is AI-generated market intelligence, not investment advice."
```

### Illustrative Risk Framework Labeling

The `entry_ref`, `stop_ref`, and `target_ref` fields in AI signals are computed from ATR-based formulas (not from an LLM or model recommendation). They are:
- Labeled as "illustrative" in all router docstrings and API responses.
- Excluded from personalized advice framing.
- Always shown alongside the disclosure statement in the frontend.

### Audit Trail

Every copilot question and every signal generation is traceable via the `audit_logs` table and the `ai_trade_signals` append-only table. Model versions (`rule-based-v1.0`, `synthesizer-v1.1`) are persisted with each record for reproducibility.

---

## Explicit Statement

All outputs from Strikfin — regime classifications, smart-money signals, FII interpretations, sentiment scores, AI bias signals, illustrative risk levels, and copilot answers — are **market intelligence for informational purposes only**.

They are **NOT** investment advice, research reports, or trading recommendations under SEBI (Research Analysts) Regulations, 2014. Users must consult a SEBI-registered Research Analyst or Investment Adviser before making any trading or investment decisions.

AI usage in this product is disclosed in every response per SEBI's guidance on AI disclosure in financial services.
