# API Reference

Base URL: `http://localhost:8000/api/v1`

Interactive Swagger UI: `http://localhost:8000/api/docs`
ReDoc: `http://localhost:8000/api/redoc`
OpenAPI JSON: `http://localhost:8000/api/openapi.json`

This file documents the **business-logic nuances** that Swagger won't show — auth semantics, field interpretations, compliance notes, and edge cases.

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

`instrument_id` is always `1` (NIFTY 50) or `2` (SENSEX).

---

## Auth (`/auth`)

### `POST /auth/register`

**Auth required:** No

Creates a new user account. The platform is single-user by design but the schema does not enforce this at the DB level.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "minimum8chars",
  "display_name": "Hari"
}
```

**Response `201`:**
```json
{
  "user_id": 1,
  "email": "user@example.com",
  "display_name": "Hari",
  "is_active": true,
  "created_at": "2026-06-20T10:00:00Z",
  "last_login_at": null
}
```

**Errors:** `409 Conflict` if email already registered.

---

### `POST /auth/login`

**Auth required:** No

Returns a short-lived JWT access token (default 60 min) and a long-lived refresh token (default 30 days). The refresh token is stored **hashed** in the database — the raw value is only ever returned here.

**Business nuance:** Email enumeration is prevented — same `401` is returned for wrong email or wrong password.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

**Response `200`:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "raw-token-store-in-localstorage",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

### `POST /auth/refresh`

**Auth required:** No (uses refresh token instead)

Validates the refresh token, immediately revokes it, and issues a **new pair** (token rotation). The old refresh token is unusable after this call.

**Request body:**
```json
{ "refresh_token": "raw-refresh-token" }
```

**Response `200`:** Same shape as `/auth/login`.

**Error:** `401` if token is invalid, expired, or already revoked.

---

### `POST /auth/logout`

**Auth required:** Yes (access token in header)

Revokes the refresh token. Idempotent — returns `204` even if the token was already revoked or not found.

**Request body:**
```json
{ "refresh_token": "raw-refresh-token" }
```

**Response:** `204 No Content`

---

### `GET /auth/me`

**Auth required:** Yes

Returns the current user's profile.

**Response `200`:** Same shape as `/auth/register` response.

---

## Dashboard (`/dashboard`)

### `GET /dashboard`

**Auth required:** Yes

One-shot composite snapshot — builds the NIFTY and SENSEX index cards concurrently, then runs the signal service for each.

**Business nuance:** the aggregate now returns options + chain for **both** instruments. `nifty_options` / `sensex_options` hold the aggregated metrics and `nifty_option_chain` / `sensex_option_chain` hold the classified chain rows. The legacy `options` / `option_chain` fields are kept as NIFTY-defaulted aliases for backwards compatibility. For guaranteed instrument-aware data the dashboards use the dedicated `/options/{id}/metrics` and `/options/{id}/chain` endpoints.

**Response `200`:**
```json
{
  "as_of": "2026-06-20T09:30:00Z",
  "market_hours": true,
  "nifty": {
    "symbol": "NIFTY50",
    "last_price": 24350.5,
    "change_pct": 0.42,
    "direction": "UP",
    "india_vix": 14.2,
    "atm_strike": 24350.0,
    "support": 24200.0,
    "resistance": 24500.0,
    "pcr_oi": 1.18
  },
  "sensex": { "...": "same shape as nifty" },
  "nifty_signal": { "...": "see /signals/{id}/latest" },
  "sensex_signal": { "...": "see /signals/{id}/latest" },
  "ai_summary": "NIFTY AI bias: **Bullish** (68% confidence)...",
  "nifty_options":  { "pcr_oi": 1.18, "max_pain": 24300.0, "support": 24200.0, "resistance": 24500.0, "writing_posture": "PUT_WRITERS_DOMINANT" },
  "sensex_options": { "...": "same shape, SENSEX values" },
  "nifty_option_chain":  [ { "strike": 24350, "type": "CE", "oi": 1234567, "buildup": "Short Build-up", "..." : "..." } ],
  "sensex_option_chain": [ { "...": "SENSEX classified rows" } ],
  "options": { "...": "alias of nifty_options (back-compat)" },
  "option_chain": [ { "...": "alias of nifty_option_chain (back-compat)" } ],
  "disclaimer": "All outputs are AI-generated market intelligence for informational purposes only. NOT investment advice. AI usage disclosed per SEBI guidelines. Consult a SEBI-registered adviser before trading."
}
```

`market_hours` is `true` if the current IST time is between 09:00 and 15:45.

---

## Index (`/index`)

### `GET /index/{instrument_id}/snapshot`

**Auth required:** Yes

Live index price data (spot, OHLC, India VIX) for the instrument.

**Response `200`** (`IndexSnapshot` schema):
```json
{
  "instrument_id": 1,
  "symbol": "NIFTY50",
  "last_price": 24350.5,
  "open_price": 24200.0,
  "high_price": 24400.0,
  "low_price": 24150.0,
  "prev_close": 24247.0,
  "change_pct": 0.42,
  "india_vix": 14.2,
  "snap_ts": "2026-06-20T09:31:00Z"
}
```

---

### `GET /index/{instrument_id}/levels`

**Auth required:** Yes

OI-derived support and resistance zones.

**Business nuance:** Support = highest Put OI strike **below** spot within 10 nearby strikes; Resistance = highest Call OI strike **above** spot within 10 nearby strikes. These are probabilistic concentration zones — not guaranteed price levels.

**Response `200`** (`IndexLevels` schema):
```json
{
  "instrument_id": 1,
  "symbol": "NIFTY50",
  "spot": 24350.5,
  "atm_strike": 24350.0,
  "support_zone": 24200.0,
  "resistance_zone": 24500.0,
  "as_of": "2026-06-20T09:31:00Z"
}
```

---

### `GET /index/{instrument_id}/futures`

**Auth required:** Yes

Near-month futures price and volume. Automatically rolls to next month after expiry Thursday.

**Response `200`:**
```json
{
  "instrument_id": 1,
  "symbol": "NIFTY50",
  "futures_symbol": "NSE:NIFTY2406FUT",
  "last_price": 24370.0,
  "prev_close": 24260.0,
  "change": 110.0,
  "change_pct": 0.45,
  "volume": 2345678,
  "open_price": 24210.0,
  "high_price": 24420.0,
  "low_price": 24180.0,
  "snap_ts": "2026-06-20T09:31:00Z",
  "source": "mock"
}
```

---

### `GET /index/{instrument_id}/short-covering`

**Auth required:** Yes

Short covering rally detection. Scores 5 signals (weights sum to 100) and returns a `score` from 0–100 with a `status` label and per-factor breakdown.

**Signal weights:**

| Signal | Weight |
|---|---|
| Call OI Unwinding | 30 |
| Day Low Recovery (≥30% of day range) | 25 (scaled: 30%→partial, 60%+→full) |
| Bearish Open (fell ≥0.10% from open) | 20 |
| Volume Spike (futures >5M = full, >1M = 60% weight) | 15 |
| Support Bounce (within 0.6% of OI support) | 10 |
| Post-Noon Window | Narrative only, no score |

**Status thresholds:** `Watching` (0–29) · `Early Signs` (30–49) · `Possible Rally` (50–69) · `Confirmed` (70–84) · `Strong Signal` (85–100)

**Response `200`** (abbreviated):
```json
{
  "instrument_id": 1,
  "status": "Possible Rally",
  "score": 55,
  "confidence_pct": 55,
  "is_post_noon": true,
  "verdict": "Market fell 0.45% from open... Call OI unwinding by -234,000 contracts...",
  "recovery_pct": 41.2,
  "call_oi_change": -234000,
  "put_oi_change": 120000,
  "pcr": 1.14,
  "support_level": 24200.0,
  "near_support": false,
  "factors": [
    { "name": "Call OI Unwinding", "fired": true, "value": "-234,000", "description": "Call OI declining (moderate) — short sellers covering positions" },
    { "name": "Day Low Recovery", "fired": true, "value": "41.2% of day range", "description": "..." }
  ],
  "snap_ts": "2026-06-20T13:15:00Z"
}
```

---

## Options (`/options`)

### `GET /options/{instrument_id}/metrics`

**Auth required:** Yes

Aggregated option chain metrics for the nearest expiry.

**Response `200`** (`OptionsMetrics` schema):
```json
{
  "instrument_id": 1,
  "snap_ts": "2026-06-20T09:31:00Z",
  "spot": 24350.5,
  "atm_strike": 24350.0,
  "pcr_oi": 1.18,
  "pcr_volume": 0.92,
  "max_pain_strike": 24300.0,
  "support_strike": 24200.0,
  "resistance_strike": 24500.0,
  "total_call_oi": 45678900,
  "total_put_oi": 53901702,
  "writing_posture": "PUT_WRITERS_DOMINANT",
  "atm_iv": 12.4,
  "iv_percentile": 23.5,
  "iv_percentile_label": "Low"
}
```

`writing_posture` values: `CALL_WRITERS_DOMINANT` · `PUT_WRITERS_DOMINANT` · `BALANCED`

`iv_percentile_label` bands: `Very Low` (0–19) · `Low` (20–39) · `Moderate` (40–59) · `High` (60–79) · `Very High` (80–100)

---

### `GET /options/{instrument_id}/chain`

**Auth required:** Yes

Full option chain with per-strike build-up classification.

**Business nuance:** `buildup_type` integer codes are also returned as `buildup_label` strings. Build-up is classified from the **price direction × OI direction** matrix — see ENGINES.md.

**Response `200`:**
```json
{
  "instrument_id": 1,
  "spot": 24350.5,
  "atm_strike": 24350.0,
  "snap_ts": "2026-06-20T09:31:00Z",
  "expiry_date": "2026-06-26",
  "chain_rows": [
    {
      "strike": 24300.0,
      "option_type": "CE",
      "ltp": 95.5,
      "oi": 1234567,
      "oi_change": 12345,
      "volume": 234567,
      "iv": 12.1,
      "delta": 0.48,
      "theta": -12.3,
      "vega": 8.7,
      "gamma": 0.0004,
      "buildup_type": 1,
      "buildup_label": "LONG_BUILDUP"
    }
  ]
}
```

---

## Options Lab (`/options-lab`)

Powers the Options Lab → Open Interest and Multi OI & Volume tools. Both are cached (`CACHE_TTL_OI`).

### `GET /options-lab/oi/{instrument_id}`

**Auth required:** Yes

Intraday Open-Interest build-up per strike: OI at the 09:15 open → OI now → the change between them, plus an OI-derived sentiment read and the per-snapshot Call/Put OI series for the interactive time-range slider.

**Data quality** (`data_quality` field):
- `intraday` — ≥2 real snapshots exist today (true open→now build-up).
- `live_proxy` — only one snapshot; the day-over-day `oi_change` is used to derive the open baseline.
- `empty` — no chain data available.

**Response `200`** (abbreviated):
```json
{
  "instrument_id": 1, "symbol": "NIFTY 50",
  "spot": 24350.5, "atm_strike": 24350.0, "max_pain": 24300.0, "lot_size": 65,
  "pcr_oi": 1.18, "pcr_change": 0.04,
  "open_ts": "2026-06-29T03:45:00Z", "now_ts": "2026-06-29T07:28:00Z",
  "data_quality": "intraday",
  "total_call_oi": 45678900, "total_put_oi": 53901702,
  "total_call_oi_chg": 1234000, "total_put_oi_chg": 2345000,
  "sentiment": { "label": "Bullish", "bullish_pct": 70, "insight": "...", "analysis": "PCR at 1.18..." },
  "strikes": [ { "strike": 24300, "call_oi_open": 898885, "call_oi_now": 1042860, "call_oi_chg": 143975, "call_oi_chg_pct": 16.0, "put_oi_open": 1, "put_oi_now": 1, "put_oi_chg": 0, "put_oi_chg_pct": 0.0 } ],
  "series": [ { "t": "...", "call": [/* aligned to strikes */], "put": [ /* ... */ ] } ]
}
```

---

### `GET /options-lab/oi-series/{instrument_id}`

**Auth required:** Yes

Intraday **time-series** of OI / Volume / OI-change per strike, used by the Multi OI & Volume tool. Returns the selectable CE/PE contracts in a window around ATM, the "High OI" / "High Volume" default selections, and one entry per snapshot with the future price and aligned `oi`/`vol`/`chg` arrays.

**Business nuance:** when only one real snapshot exists, the service synthesizes a 09:15 "open" point from the day-over-day OI change (`open_oi = now_oi − oi_change`), so the line chart always draws an open→now curve instead of a single floating point. `data_quality` still reports `live_proxy` in that case.

**Response `200`** (abbreviated):
```json
{
  "instrument_id": 1, "symbol": "NIFTY 50", "lot_size": 65,
  "spot": 24350.5, "atm_strike": 24350.0, "trade_date": "2026-06-29",
  "open_ts": "2026-06-29T03:45:00Z", "now_ts": "2026-06-29T07:28:00Z",
  "data_quality": "live_proxy",
  "contracts": [ { "id": "24000CE", "strike": 24000, "type": "CE" } ],
  "default_ids": ["24000CE", "24100CE", "24200CE", "24000PE", "24500CE"],
  "default_vol_ids": ["24000PE", "24100PE", "..."],
  "series": [ { "t": "...", "fut": 24350.5, "oi": [/* aligned to contracts */], "vol": [/* ... */], "chg": [/* ... */] } ]
}
```

---

## Smart Money (`/smart-money`)

### `GET /smart-money/{instrument_id}`

**Auth required:** Yes

Smart-money signal detection from per-strike OI activity. Only strikes with `oi ≥ 10,000` are evaluated; signals with `strength < 0.02` are filtered out.

**Signal types:** `1` Long Build-up · `2` Short Build-up · `3` Long Unwinding · `4` Short Covering · `5` Unusual OI · `6` Unusual Volume

**Unusual OI:** fires when `|oi_change| > 10%` of total OI at that strike.
**Unusual Volume:** fires when `volume > 15%` of total OI at that strike.

**Aggregate bias rule:** `bull_score > bear_score × 1.2` → Bullish; `bear_score > bull_score × 1.2` → Bearish; otherwise Neutral.

**Response `200`:**
```json
{
  "instrument_id": 1,
  "as_of": "2026-06-20T09:31:00Z",
  "spot": 24350.5,
  "aggregate_bias": 1,
  "aggregate_bias_label": "Bullish",
  "aggregate_confidence": 0.67,
  "total_signals_found": 23,
  "top_signals": [
    {
      "strike": 24400.0,
      "option_type": "PE",
      "signal_type": 4,
      "signal_label": "Short Covering",
      "oi": 1234567,
      "oi_change": -123456,
      "volume": 89012,
      "strength": 0.1,
      "confidence": 0.455
    }
  ],
  "summary": "10 smart-money signals detected. Aggregate bias: Bullish (67% confidence)."
}
```

---

## Institutional (`/institutional`)

### `GET /institutional`

**Auth required:** Yes

FII/DII institutional flow summary. Data is always `is_provisional: true` in the current implementation — final NSDL/CDSL data integration is a planned roadmap item.

**Interpretation logic:** `fii_net > ₹1,000 cr` = bullish cash flow; `dii_net > ₹500 cr` = domestic absorption; `fii_long > fii_short × 1.15` = bullish futures positioning. Overall verdict requires ≥2 bullish or ≥2 bearish signals.

**Business nuance:** `rolling_5d_fii_net` and `rolling_20d_fii_net` are currently approximated from a random multiplier of today's value. Real values require historical DB queries.

**Response `200`:**
```json
{
  "trade_date": "2026-06-20",
  "fii_cash_net_cr": 1450.0,
  "dii_cash_net_cr": -320.0,
  "fii_idx_fut_net_cr": 890.0,
  "fii_long_contracts": 234567,
  "fii_short_contracts": 189234,
  "rolling_5d_fii_net": 6200.0,
  "rolling_20d_fii_net": 18500.0,
  "interpretation": "FII net bought ₹1,450 cr in cash | DII flows neutral | FII index futures net long → bullish derivatives positioning → Overall: Bullish institutional posture",
  "is_provisional": true,
  "as_of": "2026-06-20T16:30:00Z",
  "note": "Provisional data. Final figures available post 19:00 IST from NSDL/CDSL."
}
```

---

## Sentiment (`/sentiment`)

### `GET /sentiment/{instrument_id}`

**Auth required:** Yes

Category-weighted news sentiment scoring. Currently uses a deterministic MD5-based mock scorer. In production this would be replaced by FinBERT inference with LLM escalation for ambiguous headlines.

**Category weights:** `RBI` 2.0 · `MACRO` 1.5 · `GLOBAL` 1.2 · `EARNINGS` 1.0 · `INDEX` 0.8

**Aggregate score formula:** `Σ(score × weight) / Σ(weight)` → range [−1.0, +1.0]

**Confidence formula:** `min(|agg_score| × 1.5 + headline_count × 0.02, 0.95)`

**Label thresholds:** `BULLISH` if score > 0.15 · `BEARISH` if score < −0.15 · `NEUTRAL` otherwise.

**Response `200`:**
```json
{
  "instrument_id": 1,
  "as_of": "2026-06-20T09:31:00Z",
  "aggregate_score": 0.18,
  "label": "BULLISH",
  "confidence": 0.43,
  "headline_count": 8,
  "top_drivers": [
    "RBI holds rates; signals accommodative stance",
    "FII inflows surge on strong monsoon forecast"
  ],
  "scored_headlines": [
    { "headline": "...", "source": "...", "category": "RBI", "sentiment_score": 0.65, "label": "BULLISH", "weight": 2.0 }
  ],
  "model": "mock-md5 (FinBERT in production)",
  "note": "Sentiment is general market commentary only. NOT investment advice. AI usage disclosed per SEBI guidelines."
}
```

---

## AI Signals (`/signals`)

### `GET /signals/{instrument_id}/latest`

**Auth required:** Yes

Synthesized AI bias signal. Fuses all intelligence modules via a weighted vote. Every call **persists a new record** to `ai_trade_signals`.

**Compliance note:** `disclosure_mode` is always `"intelligence"`. `entry_ref`, `stop_ref`, and `target_ref` are **illustrative risk-framework values only** computed from ATR-based formulas. They are NOT buy/sell recommendations.

**Response `200`** (`AISignalOut` schema):
```json
{
  "instrument_id": 1,
  "as_of": "2026-06-20T09:31:00Z",
  "bias": 1,
  "bias_label": "Bullish",
  "entry_ref": 24350.5,
  "stop_ref": 24167.3,
  "target_ref": 24701.1,
  "risk_reward": 1.92,
  "confidence": 0.68,
  "reasoning": "**Bullish** bias | confidence 68% | Trend Up (72% conf) · Long build-up — fresh longs entering · Smart money bullish (67% conf) · Sentiment score +0.18 (43% conf)",
  "disclosure_mode": "intelligence",
  "model_version": "synthesizer-v1.1",
  "disclaimer": "AI-generated intelligence only. NOT investment advice. AI usage disclosed per SEBI guidelines. Consult a SEBI-registered adviser before trading."
}
```

---

### `GET /signals/{instrument_id}/accuracy`

**Auth required:** Yes

Historical accuracy of past AI signals for the instrument, computed from the
`signal_outcomes` table (settled signals scored by the background scorer loop via
the `outcome` engine). Returns hit-rate and average realised R-multiple.

---

### `POST /signals/{instrument_id}/score`

**Auth required:** Yes

Manually triggers a re-scoring pass of open signals against the latest price
(the same work the background scorer loop runs every `SCORER_INTERVAL_SECONDS`).
Useful for testing or forcing an immediate evaluation.

---

## Copilot (`/copilot`)

### `POST /copilot/ask`

**Auth required:** Yes

AI-grounded market Q&A. Builds a live context object, then routes to the configured LLM provider or a rule-based fallback.

**Guardrails enforced in both LLM and rule-based paths:**
- Answers only from the provided market context — no hallucinated numbers.
- Never gives personalized buy/sell advice, entry/exit calls, or position sizing.
- Every response ends with the disclosure statement.
- Question max length: 500 characters.

**Request body:**
```json
{
  "question": "Is NIFTY bullish today?",
  "instrument_id": 1
}
```

**Response `200`** (`CopilotResponse` schema):
```json
{
  "answer": "NIFTY50 is showing a **Bullish** bias with 68% confidence. PCR at 1.18. This is AI-generated market intelligence, not investment advice.",
  "sources": [
    "Live spot & options data",
    "AI signal synthesizer (synthesizer-v1.1)",
    "News sentiment feed"
  ],
  "confidence": 0.68,
  "disclaimer": "AI copilot answers are grounded in platform data only. NOT investment advice."
}
```

When `LLM_PROVIDER=openai`, the `sources` list gains `"OpenAI gpt-4o-mini"`. When `LLM_PROVIDER=anthropic`, it gains `"Anthropic claude-sonnet-4-6"`. On LLM error the rule-based fallback is used and sources notes the error.

---

## Fyers Auth (`/auth/fyers`)

### `GET /auth/fyers/login`

**Auth required:** No

Returns the Fyers OAuth URL. The user must open this URL in a browser to authenticate with Fyers. After login, Fyers redirects to `/auth/fyers/callback`.

**Response `200`:**
```json
{
  "login_url": "https://api.fyers.in/api/v2/generate-authcode?...",
  "instructions": ["1. Open the login_url...", "2. Login with Fyers credentials..."],
  "app_id": "YOUR_APP_ID",
  "redirect_uri": "http://127.0.0.1:8000/api/v1/auth/fyers/callback"
}
```

---

### `GET /auth/fyers/callback`

**Auth required:** No (Fyers OAuth redirect)

Exchanges `auth_code` for a Fyers access token and saves it to the in-memory token store. Returns an HTML success or error page (not JSON).

**Query params:** `auth_code` (required), `s` (Fyers state, optional)

---

### `GET /auth/fyers/status`

**Auth required:** No

Returns whether a valid Fyers token is currently stored and whether a live Fyers API check succeeds.

---

### `DELETE /auth/fyers/token`

**Auth required:** No

Clears the stored Fyers access token.

---

### `POST /auth/fyers/token`

**Auth required:** No

Manually sets a Fyers access token without going through the OAuth flow. Useful for daily token paste-in when using external token generation tools.

**Request body:**
```json
{ "access_token": "your_fyers_token_here" }
```

---

### `GET /auth/fyers/debug/chain/{instrument_id}`

**Auth required:** No

Returns the raw Fyers option-chain API response for inspection. Development/debugging endpoint only.

---

## Error Response Shape

Domain errors (raised as `AppError`) and unhandled exceptions are returned under an `error` key by the app's exception handlers:

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Token has expired"
  }
}
```

FastAPI's own request-validation failures (422) use the framework default `{"detail": [ ... ]}` shape instead.

| HTTP Status | When | Shape |
|---|---|---|
| `400 Bad Request` | Domain validation failure | `{"error": {...}}` |
| `401 Unauthorized` | Missing, expired, or invalid JWT / refresh token | `{"error": {...}}` |
| `404 Not Found` | Resource not found | `{"error": {...}}` |
| `409 Conflict` | Duplicate email on register | `{"error": {...}}` |
| `422 Unprocessable Entity` | FastAPI schema/body validation error | `{"detail": [...]}` |
| `500 Internal Server Error` | Unhandled exception | `{"error": {"code": "INTERNAL_ERROR", ...}}` |
