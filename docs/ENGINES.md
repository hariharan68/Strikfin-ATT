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

## 2. Regime Classifier (`engines/regime.py`)

### Input: `RegimeFeatures` dataclass

| Field | Type | Description |
|---|---|---|
| `return_1d` | `float` | Today's % return |
| `return_5d` | `float` | 5-day % return |
| `trend_strength` | `float` | ADX-style score 0–100 |
| `range_compression` | `float` | Today range / 20d ATR (< 0.7 = compressed) |
| `india_vix` | `Optional[float]` | Current India VIX |
| `vix_percentile` | `float` | VIX position in 52-week range, 0–1 |
| `realized_vol_pct` | `float` | Today realized vol percentile |
| `pcr_oi` | `float` | Put-Call ratio (OI) |
| `oi_buildup` | `str` | `LONG_BUILDUP` / `SHORT_BUILDUP` / `SHORT_COVERING` / `LONG_UNWINDING` |
| `writing_posture` | `str` | `CALL_WRITERS_DOMINANT` / `PUT_WRITERS_DOMINANT` / `BALANCED` |
| `spot_vs_max_pain` | `float` | `(spot − max_pain) / spot` |
| `fii_cash_net_cr` | `Optional[float]` | FII net cash (₹ crore) |
| `fii_fut_bias` | `str` | `LONG` / `SHORT` / `NEUTRAL` |

### 7 Regime States

| Code | Label | Meaning |
|---|---|---|
| `1` | Trend Up | Sustained upward move with strength |
| `2` | Trend Down | Sustained downward move with strength |
| `3` | Sideways | Range-bound, low directional momentum |
| `4` | Breakout | Price breaking compressed range |
| `5` | Reversal | Momentum turning, OI unwinding |
| `6` | High Volatility | VIX spike or range expansion |
| `7` | Low Volatility | Compressed, calm, pre-event often |

### Scoring Algorithm

Weighted evidence vote. Each signal adds score to one or more regime buckets. Winner = highest score. Confidence = `winner_score / max_possible` (max_possible = `13.0`), with a floor of `0.35`.

| Signal Group | Max Weight | Conditions |
|---|---|---|
| **Volatility** | 3.0 | VIX percentile > 0.80 → +3.0 to regime 6; < 0.20 → +2.0 to regime 7 |
| **Range** | 1.5 | range_compression < 0.65 → +1.5 to regime 7; > 1.5 → +1.5 to regime 6 |
| **Trend** | 2.5 | ADX > 30 + 1d & 5d both positive → +2.5 to regime 1; both negative → +2.5 to regime 2; ADX < 20 → +1.5 to regime 3 |
| **OI Build-up** | 2.0 | LONG_BUILDUP → +2.0 to 1; SHORT_BUILDUP → +2.0 to 2; LONG_UNWINDING → +1.0 to 5 + 0.5 to 2; SHORT_COVERING → +0.5 to 5 + 1.0 to 1 |
| **Writing Posture** | 1.0 | PUT_WRITERS_DOMINANT → +1.0 to 1; CALL_WRITERS_DOMINANT → +1.0 to 2 |
| **Breakout** | 2.5 | range_compression < 0.70 AND \|return_1d\| > 0.80% AND buildup in (LONG/SHORT_BUILDUP) → +2.5 to 4 |
| **FII Cash** | 0.5 | fii_cash_net_cr > 2000 → +0.5 to 1; < −2000 → +0.5 to 2 |
| **FII Futures** | 0.5 | LONG bias → +0.5 to 1; SHORT bias → +0.5 to 2 |

**Total max possible: 13.0**

---

## 3. AI Signal Synthesizer (`engines/synthesizer.py`)

### Input: `SignalInputs` dataclass

Accepts outputs from all other modules (regime, options, smart money, FII, sentiment) plus current spot and ATR estimate.

### Output: `SynthesizedSignal` dataclass

| Field | Type | Notes |
|---|---|---|
| `bias` | `int` | `1` Bullish · `0` Neutral · `-1` Bearish |
| `entry_ref` | `Optional[float]` | Illustrative — equals `spot` |
| `stop_ref` | `Optional[float]` | Illustrative — formula below |
| `target_ref` | `Optional[float]` | Illustrative — formula below |
| `risk_reward` | `Optional[float]` | `\|target − entry\| / \|entry − stop\|` |
| `confidence` | `float` | Clamped to [0.30, 0.95] |
| `reasoning` | `str` | Plain-English markdown string |
| `evidence` | `dict` | Per-module evidence strings |

### Weighted Vote

```
bias_score = 0.0

Regime (weight 3.0):
  TREND_UP   → +3.0 × regime_confidence
  TREND_DOWN → −3.0 × regime_confidence
  BREAKOUT   → ±2.4 × regime_confidence (direction from oi_buildup)
  REVERSAL   → ±1.5 × regime_confidence
  HIGH_VOL   → 0 (neutral)
  SIDEWAYS / LOW_VOL → 0 (neutral)

OI Build-up (weight 2.5):
  LONG_BUILDUP    → +2.5
  SHORT_BUILDUP   → −2.5
  SHORT_COVERING  → +1.5  (0.6 × 2.5)
  LONG_UNWINDING  → −1.5

Writing Posture addon:
  PUT_WRITERS_DOMINANT  → +0.8
  CALL_WRITERS_DOMINANT → −0.8

Smart Money (weight 2.0):
  bias_score += smart_money_bias × 2.0 × smart_money_confidence

FII Cash (weight up to 0.75 of 1.5):
  fii_net_cr > 2000  → +0.75
  fii_net_cr < −2000 → −0.75

FII Futures (weight up to 0.75 of 1.5):
  LONG  → +0.75
  SHORT → −0.75

Sentiment (weight 1.0):
  bias_score += sentiment_score × 1.0 × sentiment_confidence

normalised = bias_score / weight_used

bias = Bullish  if normalised >  0.15
     = Bearish  if normalised < −0.15
     = Neutral  otherwise
```

**Total weight_used: 10.0**

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

## 4. Short Covering Detector (`engines/short_covering.py`)

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

## 5. Sentiment Scorer (`api/v1/routers/sentiment.py`)

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

## 6. Smart Money Detector (`api/v1/routers/smart_money.py`)

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
