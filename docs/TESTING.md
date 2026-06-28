# Testing

## Test Infrastructure

| Tool | Version | Role |
|---|---|---|
| `pytest` | 8.3.4 | Test runner |
| `pytest-asyncio` | 0.24.0 | Async test support |

Tests live in `backend/tests/`. The only currently populated test suite is `tests/unit/engines/`.

---

## Running the Tests

```bash
cd backend
venv\Scripts\activate   # or source venv/bin/activate on Unix

# Run all tests
pytest

# Run a specific file
pytest tests/unit/engines/test_options_math.py

# Verbose output
pytest -v

# With coverage (if coverage is installed)
pytest --cov=app tests/
```

---

## Currently Covered: `tests/unit/engines/`

The unit test files exist in the directory but are currently empty stubs (each file contains only a single newline). No test functions have been written yet.

The three test files and the engine functions they are intended to cover:

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

### `test_regime.py` — targets `engines/regime.py`

Intended coverage:
- `classify_regime` — all 7 regime outcomes with appropriate feature inputs
- Confidence floor at 0.35 even when all signals are weak
- `max_possible = 13.0` denominator
- Evidence dict contents for each major signal group

### `test_synthesizer.py` — targets `engines/synthesizer.py`

Intended coverage:
- `synthesize` — all three bias outcomes (Bullish / Neutral / Bearish)
- Normalised threshold of ±0.15 for bias determination
- Confidence clamp to [0.30, 0.95]
- Entry/stop/target formulas with and without support/resistance
- Risk-reward calculation
- Neutral output when all inputs are zero/neutral

---

## Known Gaps

The following areas have **no test coverage** at this time:

| Area | Why it matters |
|---|---|
| Auth service (`services/auth_service.py`) | Password hashing, token rotation, logout idempotency |
| Regime service | Feature assembly from raw provider data |
| Signal service | Module fusion logic, FII/sentiment derivation |
| Options service | Full chain classification, snapshot persistence |
| Short covering engine | All 5 signal weights, status thresholds, recovery_pct scaling |
| Sentiment scorer | Category weighting, confidence formula |
| Smart money detector | OI/volume threshold overrides, aggregate bias logic |
| API endpoints (integration) | Full request/response with a real DB |
| Provider mock data | Mock data shapes assumed consistent with engine expectations |
| Fyers provider | Not testable without a live Fyers token (needs mocking) |

---

## Recommended Next Steps

1. **Write unit tests for the engine functions** — all engines are pure Python with no external dependencies, making them trivially testable without a DB or network.
2. **Add a `conftest.py`** with shared fixtures (e.g., a minimal `ChainRow` list, a typical `RegimeFeatures` instance).
3. **Add integration tests** against a disposable PostgreSQL instance (e.g. a throwaway Docker container or a dedicated test database) so the asyncpg dialect, JSON columns, and constraints are exercised exactly as in production.
4. **Add `pytest-cov`** to requirements and set a coverage gate in CI.
