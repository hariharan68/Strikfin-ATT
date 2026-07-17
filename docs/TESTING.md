# Testing

## Test Infrastructure

| Tool | Version | Role |
|---|---|---|
| `pytest` | 8.3.4 | Backend test runner |
| `pytest-asyncio` | 0.24.0 | Async test support |
| `vitest` | 3 | Frontend test runner (jsdom) |

Backend tests live in `backend/tests/`; the populated suite is `tests/unit/services/` (GEX payload). Frontend tests live beside the code in `frontend/src/**/__tests__/`.

> `backend/pyproject.toml` sets `[tool.pytest.ini_options] pythonpath = ["."]` so `app.*` imports resolve when running `uv run pytest` from `backend/`.

---

## Running the Tests

### Backend (from `backend/`)

```bash
cd backend

# Run all backend tests (uv runs them inside the project's Python 3.11 env)
uv run pytest

# Run a specific file
uv run pytest tests/unit/services/test_options_lab_gex.py

# Verbose output
uv run pytest -v
```

### Frontend (from `frontend/`)

```bash
cd frontend

# Run the vitest suite once
npx vitest run

# Run a specific file (22 GEX math tests)
npx vitest run src/lib/__tests__/gex.test.ts
```

---

## Currently Covered

### Frontend — `src/lib/__tests__/gex.test.ts` (22 tests)

The Gamma Exposure math module (`src/lib/gex.ts`) is fully unit-tested: `bsGamma`
(Black-Scholes gamma + input guards), `computeStrikeGEX` (dealer sign convention,
missing-IV skip, per-1%-move `spot²·0.01` scaling), `computeWalls`
(call-side / put-side gamma walls), `computeNetGexCross` (per-strike net zero-cross,
nearest-spot selection), `computeZeroGamma` (zero-gamma spot via candidate-spot
bisection; verified recomputed net GEX ≈ 0 at the flip), and `yearsToExpiry` /
`toCrore` helpers.

### Backend — `tests/unit/services/test_options_lab_gex.py`

Payload-shape tests for `options_lab_service.get_gex_series` (aligned call/put OI +
IV arrays per strike, spot/`expiry_ts`/`risk_free`/`lot_size` present, `None`
pass-through for missing IV).

---

## Engine stubs: `tests/unit/engines/`

The engine test files still exist but are currently empty stubs (each contains only
a single newline). No test functions are written for them yet.

The three files and the engine functions they are intended to cover:

### `test_options_math.py` — targets `engines/options_math.py`

Intended coverage:
- `pcr_oi` — verify `Σ PE_OI / Σ CE_OI` including the `call_oi == 0` guard
- `pcr_volume` — same logic for volume
- `classify_buildup` — all 4 price × OI direction combinations
- `max_pain` — verify the strike with minimum total payout is returned
- `oi_walls` — support below spot, resistance above spot, 10-strike window
- `atm_strike` — nearest strike selection
- `atm_iv` — mean of CE and PE IV, None-filtering for zero/None values
- `iv_percentile` — linear position within [10, 25] band, clamped 0–100
- `iv_percentile_label` — bucket labels
- `writing_posture` — `ratio = ce_writing / (pe_writing + 1)` thresholds at 1.3 / 0.77
- `trend_strength` — ADX-style calculation with minimal close series

### `test_regime.py` — **orphaned**

This stub targeted `engines/regime.py`, which has since been removed (regime was
folded into the synthesizer). The file should be deleted or repurposed to cover
the `short_covering` and `outcome` engines, which currently have no test file.

### `test_synthesizer.py` — targets `engines/synthesizer.py`

Intended coverage:
- `synthesize` — all three bias outcomes (Bullish / Neutral / Bearish)
- Normalised threshold of ±0.15 for bias determination
- Confidence clamp to [0.30, 0.95]
- Entry/stop/target formulas with and without support/resistance
- Risk-reward calculation
- Neutral output when all inputs are zero/neutral
- Weighted vote sums to `weight_used = 7.0` (OI 2.5 + Smart Money 2.0 + FII 1.5 + Sentiment 1.0)

---

## Known Gaps

The following areas have **no test coverage** at this time:

| Area | Why it matters |
|---|---|
| Auth service (`services/auth_service.py`) | Password hashing, single-use token rotation, logout idempotency |
| Session restore / refresh coalescing (frontend) | `refreshAccessTokenOnce` / `restoreSession` single-flight under concurrent callers |
| Cache facade (`core/cache.py`) | Circuit breaker + in-process fallback when Redis is down |
| Signal service | Module fusion logic, FII/sentiment derivation |
| Options service | Full chain classification, snapshot persistence |
| Options Lab service | Intraday series assembly, single-snapshot synthetic open point |
| Short covering / outcome engines | Signal weights, status thresholds, R-multiple evaluation |
| Sentiment scorer | Category weighting, confidence formula |
| Smart money detector | OI/volume threshold overrides, aggregate bias logic |
| API endpoints (integration) | Full request/response with a real DB |
| Fyers provider | Not testable without a live Fyers token (needs mocking) |

---

## Recommended Next Steps

1. **Write unit tests for the engine functions** — all engines are pure Python with no external dependencies, making them trivially testable without a DB or network.
2. **Add a `conftest.py`** with shared fixtures (e.g., a minimal `ChainRow` list and a typical `SignalInputs` instance).
3. **Add integration tests** against a disposable PostgreSQL instance (e.g. a throwaway Docker container or a dedicated test database) so the asyncpg dialect, JSON columns, and constraints are exercised exactly as in production.
4. **Add `pytest-cov`** to requirements and set a coverage gate in CI.
