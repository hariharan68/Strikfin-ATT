# Architecture

## 3-Tier Overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  (React 19 / Vite)                                │
│  localhost:5173                                             │
│                                                             │
│  Pages: Dashboard · Options · Regime · Signals ·            │
│         SmartMoney · Institutional · Sentiment · Copilot    │
│  State: Zustand stores (authStore)                          │
│  HTTP:  Axios → /api/v1/* via proxy to :8000                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/JSON  (Bearer JWT)
┌────────────────────────▼────────────────────────────────────┐
│  BACKEND  (FastAPI / Uvicorn)                               │
│  localhost:8000                                             │
│                                                             │
│  Router → Service → Engine → Provider                       │
│  Swagger UI at /docs · ReDoc at /redoc                      │
└────────────────────────┬────────────────────────────────────┘
                         │ SQLAlchemy async (aioodbc)
┌────────────────────────▼────────────────────────────────────┐
│  DATABASE  (Microsoft SQL Server)                           │
│  Windows Authentication — no username/password in code      │
│  Named instance, e.g. MACHINE\SQLEXPRESS                    │
│  Database: StrikfinDB                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Backend Layer Responsibilities

### Router (`app/api/v1/routers/`)

- Receives HTTP request; validates path/query parameters using FastAPI type annotations.
- Instantiates the appropriate Service and delegates all work to it.
- Returns the Service's Pydantic schema directly.
- **Must not** contain business logic, raw SQL, or direct engine calls.
- **Must not** import from other routers.

### Service (`app/services/`)

- Orchestrates the full data pipeline: fetch from provider → compute via engine → persist to DB → return schema.
- Owns the transaction boundary (`await db.commit()`).
- Converts between raw provider dicts and typed engine dataclasses.
- **Must not** be called by another service.
- **Must not** contain pure math (move that to an engine).

### Engine (`app/engines/`)

- Pure Python functions and dataclasses.
- **Zero** imports from `app.db`, `app.api`, `app.ingestion`, or any network library.
- All inputs are plain scalars, lists, or dataclasses; all outputs are plain scalars, tuples, or dataclasses.
- Must be independently unit-testable without a database or network.
- Current engines: `options_math`, `regime`, `synthesizer`, `short_covering`.

### Provider (`app/ingestion/providers/`)

- Retrieves raw market data from an external source or generates mock data.
- Returns plain `dict` or `list[dict]` — no Pydantic, no SQLAlchemy.
- Selected at import time by `settings.MARKET_DATA_VENDOR`.
- **Must not** contain business logic or computation.

### DB Models (`app/db/models.py`)

- SQLAlchemy ORM table definitions only.
- All market tables are **append-only** — no UPDATE statements.
- The auth tables (`users`, `refresh_tokens`) are mutable.
- **Must not** contain domain logic.

### Schemas (`app/domain/schemas.py`)

- Pydantic v2 models for request validation and response serialization.
- No DB imports — pure data shapes.

---

## Provider Abstraction

The `app/ingestion/providers/__init__.py` module is the single dispatch point for all market-data access. Every function in it checks `settings.MARKET_DATA_VENDOR` and lazily imports the correct provider:

```python
# Switching from mock to live is one env-var change:
MARKET_DATA_VENDOR=fyers   # or "mock"
```

| Function | Mock | Fyers |
|---|---|---|
| `get_spot(instrument_id)` | Deterministic random data | Fyers quotes API |
| `get_option_chain(instrument_id)` | Generated synthetic chain | Fyers optionchain API |
| `get_futures(instrument_id)` | Synthetic futures | Fyers quotes API |
| `get_news_headlines(limit)` | Static fixture list | Mock only (no Fyers news feed) |
| `get_institutional_activity(date)` | Static fixture data | Mock only (no Fyers flow data) |

> **Note:** News headlines and FII/DII institutional activity are always sourced from the mock provider regardless of `MARKET_DATA_VENDOR`. Production integration with a news API or NSDL data feed is a planned roadmap item.

---

## Authentication Flow

```
POST /auth/login
  → AuthService validates credentials
  → Issues short-lived JWT access token (default 60 min)
  → Issues long-lived refresh token (default 30 days), stored HASHED in DB
  → Client stores refresh token in localStorage

Every protected request:
  → Authorization: Bearer <access_token>
  → deps.get_current_user_id() decodes JWT, returns user_id

Token rotation:
  POST /auth/refresh
  → Validates refresh token hash in DB
  → Revokes the old refresh token (sets revoked_at)
  → Issues a new access + refresh token pair
```

---

## Data Flow: A Single Request (e.g. GET /regime/1)

```
HTTP GET /api/v1/regime/1
  ↓
routers/regime.py: get_regime(instrument_id=1)
  ↓
RegimeService.get_current_regime(1)
  ↓ calls
  providers.get_spot(1)          → spot dict
  providers.get_option_chain(1)  → chain dict with rows[]
  ↓ computes
  options_math.pcr_oi(rows)
  options_math.writing_posture(rows)
  ↓ builds
  RegimeFeatures dataclass
  ↓ calls
  engines.regime.classify_regime(features)
    → (regime_code, confidence, evidence)
  ↓ persists
  db.add(MarketRegime(...))
  await db.commit()
  ↓ returns
  RegimeRead Pydantic schema → JSON response
```

---

## Frontend Route Map

| URL path | Page component | Primary API call |
|---|---|---|
| `/` | `LoginPage` | `POST /auth/login` |
| `/dashboard` | `DashboardPage` | `GET /dashboard` |
| `/advanced-dashboard` | `AdvancedDashboardPage` | `GET /dashboard` + per-module |
| `/options` | `OptionsPage` | `GET /options/{id}/metrics` |
| `/advance-oi` | `AdvanceOIPage` | `GET /options/{id}/chain` |
| `/regime` | `RegimePage` | `GET /regime/{id}` |
| `/signals` | `SignalsPage` | `GET /signals/{id}/latest` |
| `/smart-money` | `SmartMoneyPage` | `GET /smart-money/{id}` |
| `/institutional` | `InstitutionalPage` | `GET /institutional` |
| `/sentiment` | `SentimentPage` | `GET /sentiment/{id}` |
| `/copilot` | `CopilotPage` | `POST /copilot/ask` |
| `/settings` | `SettingsPage` | `GET /auth/fyers/status` |
