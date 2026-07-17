# Computation Engines

All engines live in `backend/app/engines/`. They share one invariant: **zero imports from `app.db`, `app.api`, `app.ingestion`, or any network library.** Every function accepts plain Python types and returns plain Python types. This makes them independently unit-testable and fully auditable.

---

## 1. Options Math (`engines/options_math.py`)

### `ChainRow` dataclass

The typed input unit for all options-math functions:

| Field | Type | Description |
|---|---|---|
| `strike` | `float` | Strike price |
| `opt_type` | `str` | `"CE"` or `"PE"` |
| `oi` | `int` | Open interest (contracts) |
| `oi_change` | `int` | Change in OI since last snapshot |
| `ltp` | `float` | Last traded price |
| `volume` | `int` | Volume in current session |
| `price_change` | `float` | Underlying % change (used for buildup classification) |
| `iv` | `Optional[float]` | Implied volatility (%) |

---

### `pcr_oi(rows)` — Put-Call Ratio (OI)

```
PCR_OI = Σ PE_OI / Σ CE_OI
```

Interpretation: `> 1.2` → put-heavy (aggressive hedging or bullish put-writing); `< 0.8` → call-heavy (bullish speculation or bearish call-writing).

---

### `pcr_volume(rows)` — Put-Call Ratio (Volume)

```
PCR_Volume = Σ PE_Volume / Σ CE_Volume
```

More responsive intraday than OI-based PCR. Used alongside PCR OI for confirmation.

---

### `classify_buildup(price_chg, oi_chg)` — Build-up Classification

Price direction × OI direction matrix:

| Price direction | OI direction | Code | Label |
|---|---|---|---|
| Up (≥ 0) | Up (≥ 0) | `1` | `LONG_BUILDUP` — fresh longs entering |
| Down (< 0) | Up (≥ 0) | `2` | `SHORT_BUILDUP` — fresh shorts entering |
| Up (≥ 0) | Down (< 0) | `3` | `SHORT_COVERING` — shorts exiting |
| Down (< 0) | Down (< 0) | `4` | `LONG_UNWINDING` — longs exiting |

`price_chg` is the **index-level** percentage change. `oi_chg` is the **strike-level** OI change.

---

### `max_pain(rows, strikes)` — Max Pain

```
For each candidate expiry price P:
  pain(P) = Σ CE_OI × max(0, P − strike)
           + Σ PE_OI × max(0, strike − P)

max_pain = argmin_P pain(P)
```

Returns the strike that minimises total intrinsic payout to all option holders. Acts as a gravitational zone near expiry, especially in the last 2–3 days before expiry Thursday.

---

### `oi_walls(rows, spot, nearby_strikes=10)` — Support & Resistance

```
Relevant range = [ATM − 10 strikes, ATM + 10 strikes]

Resistance = strike with highest CE OI ABOVE spot (within relevant range)
Support    = strike with highest PE OI BELOW spot (within relevant range)
```

The 10-strike window prevents distant illiquid strikes from dominating the result.

---

### `atm_strike(spot, strikes)` — ATM Strike

```
ATM = argmin_{s ∈ strikes} |s − spot|
```

Fallback (no strikes): `round(spot / 50) × 50`.

---

### `atm_iv(rows, atm)` — ATM Implied Volatility

Mean of CE and PE IV at the ATM strike. IV values of `0` or `None` are treated as missing (no IV data from feed) rather than reported as zero.

---

### `iv_percentile(atm_iv_val)` — IV Percentile

```
percentile = (atm_iv − lo) / (hi − lo) × 100
```

Where `lo = 10.0` and `hi = 25.0` (typical NIFTY/SENSEX ATM IV band). This is a **linear proxy** — production should use a rolling 1-year IV history.

Labels: `Very Low` (0–19) · `Low` (20–39) · `Moderate` (40–59) · `High` (60–79) · `Very High` (80–100)

---

### `writing_posture(rows)` — Option Writing Posture

```
ce_writing = Σ oi_change for CE rows where oi_change > 0
pe_writing = Σ oi_change for PE rows where oi_change > 0

ratio = ce_writing / (pe_writing + 1)

ratio > 1.3   → CALL_WRITERS_DOMINANT  (ceiling defense, bearish)
ratio < 0.77  → PUT_WRITERS_DOMINANT   (floor defense, bullish)
else          → BALANCED
```

---

### `trend_strength(closes, period=14)` — ADX-Style Trend Strength

Smoothed Directional Movement Index (ADX-inspired). Returns 0–100 where:
- `> 30` = strong directional trend
- `20–30` = moderate
- `< 20` = sideways / weak trend

Uses Wilder-style smoothing (exponential moving average with factor `1/n`). Returns `0.0` if fewer than `period + 1` closes are provided.

---

### `black76_price` · `greeks` · `implied_vol` — Black-76 option model

Fyers does not return IV or greeks, so they are recovered locally:

- `black76_price(opt_type, forward, strike, t_years, sigma)` — Black-76 (futures-style) option price.
- `implied_vol(opt_type, premium, forward, strike, t_years)` — Newton/bisection solve for IV (%) from the traded premium. Returns `None` for un-solvable inputs (e.g. zero premium / past expiry).
- `greeks(opt_type, forward, strike, t_years, sigma)` — `delta`, `gamma`, `theta`, `vega` from the same model.

---

### `net_gex` · `gamma_flip_strike` · `gex_label` — Gamma Exposure

```
net_gex(rows, spot, lot_size)  → Σ (gamma × OI × lot × spot² × 0.01),
                                  signed +CE / −PE  (₹ crore)
gamma_flip_strike(rows, spot)  → strike where cumulative dealer gamma flips sign
gex_label(gex)                 → "Positive (stabilising)" / "Negative (amplifying)"
```

Net GEX > 0 implies dealers are long gamma (mean-reverting / pinning); < 0 implies short gamma (trend-amplifying). Powers the Advanced Dashboard's Net GEX / Zero-Gamma Flip tiles.

> **Options Lab GEX tool computes GEX in the browser, not here.** The `net_gex`
> engine above powers the *Advanced Dashboard* tiles. The Options Lab → Gamma
> Exposure tool instead pulls raw per-snapshot OI + IV from
> `GET /options-lab/gex-series/{id}` and runs all math client-side in the pure
> module `frontend/src/lib/gex.ts`. Its formulas (kept deliberately parallel):
> - `computeStrikeGEX` — per-strike dealer GEX `gamma·OI·lot·spot²·0.01`
>   (identical per-1%-move scaling as `net_gex`), dealer signs +CE / −PE;
>   missing/NULL IV → that leg contributes 0.
> - `computeWalls` — **Call Wall** = strike with the largest call-side GEX,
>   **Put Wall** = largest put-side GEX magnitude (SpotGamma definition).
> - `computeNetGexCross` — the per-strike net-GEX profile zero-cross nearest spot.
> - `computeZeroGamma` — the true **zero-gamma spot**: recomputes every strike's
>   Black-Scholes gamma at candidate spots and bisects the total-net sign change
>   (so a flip exists even on a net-short day, unlike a cumulative across-strike
>   sum). This supersedes the engine's simpler `gamma_flip_strike` for the tool.

---

### `true_range` · `atr` · `realized_vol` — Volatility from OHLC candles

- `true_range(high, low, prev_close)` — classic true range.
- `atr(candles, period=20)` — Average True Range over daily candles (powers the synthesizer's illustrative stop/target). Returns `None` with insufficient history.
- `realized_vol(candles, period=20)` — annualised close-to-close realised volatility (%).

These consume the candles returned by `providers.get_history(...)`.

---

## 2. AI Signal Synthesizer (`engines/synthesizer.py`)

Fuses the options, smart-money, institutional, and sentiment modules into a single bias. **Pure function — no regime input** (the earlier standalone regime engine was removed; the synthesizer is now the single bias authority behind `/signals/{id}/latest`).

### Input: `SignalInputs` dataclass

| Group | Fields |
|---|---|
| Options | `pcr_oi`, `writing_posture`, `oi_buildup`, `spot`, `support`, `resistance`, `max_pain`, `atr_20` |
| Smart Money | `smart_money_bias` (1/0/−1), `smart_money_confidence` (0–1) |
| Institutional | `fii_net_cr`, `fii_fut_bias` (LONG/SHORT/NEUTRAL) |
| Sentiment | `sentiment_score` (−1..1), `sentiment_confidence` (0–1) |

### Output: `SynthesizedSignal` dataclass

| Field | Type | Notes |
|---|---|---|
| `bias` | `int` | `1` Bullish · `0` Neutral · `-1` Bearish |
| `entry_ref` | `Optional[float]` | Illustrative — equals `spot` |
| `stop_ref` | `Optional[float]` | Illustrative — formula below |
| `target_ref` | `Optional[float]` | Illustrative — formula below |
| `risk_reward` | `Optional[float]` | `\|target − entry\| / \|entry − stop\|` |
| `confidence` | `float` | `max(min(\|normalised\|, 0.95), 0.30)` |
| `reasoning` | `str` | Plain-English markdown string (top-4 evidence) |
| `evidence` | `dict` | Per-module evidence strings |

### Weighted Vote

```
bias_score  = 0.0
weight_used = 0.0

OI Build-up (weight 2.5):
  LONG_BUILDUP    → +2.5
  SHORT_BUILDUP   → −2.5
  SHORT_COVERING  → +1.5   (0.6 × 2.5)
  LONG_UNWINDING  → −1.5
  Writing posture addon:  PUT_WRITERS_DOMINANT +0.8 · CALL_WRITERS_DOMINANT −0.8
  weight_used += 2.5

Smart Money (weight 2.0):
  bias_score += smart_money_bias × 2.0 × smart_money_confidence
  weight_used += 2.0

FII (weight 1.5):
  fii_net_cr > 2000  → +0.75   ;  < −2000 → −0.75   (cash, 0.5 × 1.5)
  fii_fut_bias LONG  → +0.75   ;  SHORT  → −0.75     (futures, 0.5 × 1.5)
  weight_used += 1.5

Sentiment (weight 1.0):
  bias_score += sentiment_score × 1.0 × sentiment_confidence
  weight_used += 1.0

normalised = bias_score / weight_used

bias = Bullish  if normalised >  0.15
     = Bearish  if normalised < −0.15
     = Neutral  otherwise
```

**Total weight_used: 7.0**

### Illustrative Risk Framework

When `atr_20` is provided (estimated as `spot × 0.015`):

```
entry_ref = spot

# Bullish
stop_ref   = support − atr_20 × 0.5  (or spot − atr_20 × 1.5 if no support)
target_ref = resistance               (or spot + atr_20 × 2.0 if no resistance)

# Bearish
stop_ref   = resistance + atr_20 × 0.5  (or spot + atr_20 × 1.5 if no resistance)
target_ref = support                    (or spot − atr_20 × 2.0 if no support)

risk_reward = |target_ref − entry_ref| / |entry_ref − stop_ref|
```

These values are labeled `disclosure_mode = "intelligence"` and are **NOT investment advice**.

---

## 3. Short Covering Detector (`engines/short_covering.py`)

Detects a classic Indian market short covering rally pattern: market opens bearish → sells off → reverses post-noon as call-short sellers exit.

### Signal Weights (must sum to 100)

| Signal | Weight | Fires When |
|---|---|---|
| Call OI Unwinding | 30 | `call_oi_change < 0` (negative = covering) |
| Day Low Recovery | 25 (scaled) | `recovery_pct ≥ 30%`; scaled: `min(recovery_pct / 60, 1.0) × 25` |
| Bearish Open | 20 | `change_from_open ≤ −0.10%` |
| Volume Spike | 15 | futures volume ≥ 5M (full) or ≥ 1M (60% partial = 9 pts) |
| Support Bounce | 10 | price within 0.6% of OI-derived support |
| Post-Noon Window | — | After 12:00 PM IST — narrative only, no score |

### Derived Metrics

```
day_range       = high_price − low_price
recovery_pct    = (ltp − low_price) / day_range × 100
change_from_open= (ltp − open_price) / open_price × 100
near_support    = |ltp − support_level| / ltp ≤ 0.006
```

### Status Labels

| Score | Status |
|---|---|
| 0–29 | `Watching` |
| 30–49 | `Early Signs` |
| 50–69 | `Possible Rally` |
| 70–84 | `Confirmed` |
| 85–100 | `Strong Signal` |

---

## 4. Sentiment Scorer (`api/v1/routers/sentiment.py`)

The sentiment scorer is inline in the router (no separate engine module). It is architecturally equivalent to an engine — pure computation over the incoming headlines list.

### Category Weights

```python
{ "RBI": 2.0, "MACRO": 1.5, "GLOBAL": 1.2, "EARNINGS": 1.0, "INDEX": 0.8 }
```

### Aggregate Score Formula

```
agg_score = Σ(score_i × weight_i) / Σ(weight_i)
```

Range: [−1.0, +1.0]

### Label Thresholds

```
BULLISH  if agg_score >  0.15
BEARISH  if agg_score < −0.15
NEUTRAL  otherwise
```

### Confidence Formula

```
confidence = min(|agg_score| × 1.5 + headline_count × 0.02, 0.95)
```

### Mock Scorer (current)

```python
score = (MD5(headline) % 2000 − 1000) / 1000.0
```

This is deterministic — the same headline always gets the same score. Production replaces this with FinBERT.

---

## 5. Smart Money Detector (`api/v1/routers/smart_money.py`)

Inline in the router. Per-strike signal detection.

### Signal Strength

```
strength = min(|oi_change| / max(oi, 1), 1.0)
```

Signals with `strength < 0.02` are discarded. Only strikes with `oi ≥ 10,000` are evaluated.

### Override Logic

```
if |oi_change| > oi × 0.10:  signal_type = UNUSUAL_OI (5)
elif volume > oi × 0.15:     signal_type = UNUSUAL_VOLUME (6)
else:                        signal_type = classify_buildup(price_change, oi_change)
```

### Aggregate Bias

```
bull_score = Σ strength for LONG_BUILDUP + SHORT_COVERING signals (types 1, 4)
bear_score = Σ strength for SHORT_BUILDUP + LONG_UNWINDING signals (types 2, 3)
total = bull_score + bear_score

Bullish  if bull_score > bear_score × 1.2
Bearish  if bear_score > bull_score × 1.2
Neutral  otherwise

confidence = max(bull_score, bear_score) / total
```

---

## 6. Signal Outcome Evaluator (`engines/outcome.py`)

Scores whether a past AI signal "worked", used by the background scorer loop and the `/signals/{id}/accuracy` endpoint.

`evaluate_path(bias, entry, stop, target, path)` walks the realised price path after a signal was issued and returns an `OutcomeResult` — which of stop/target was hit first and the realised **R-multiple** (`realised_R = realised_move / initial_risk`, signed by `bias`). Signals that hit neither within the evaluation horizon settle as `EXPIRED` at the last observed price.

This is the only place "was the call right?" is computed; the synthesizer itself never sees outcomes (no look-ahead).
