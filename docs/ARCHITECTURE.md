# Architecture

## 3-Tier Overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  (React 19 / Vite)                                │
│  localhost:5173                                             │
│                                                             │
│  Pages: Dashboard · Advanced Dashboard · Options ·          │
│         Options Lab · Future Lab · Analyse · Option Chain ·  │
│         Smart Money · Institutional · All-in-One · Copilot   │
│  State: Zustand store (authStore) · theme store (useTheme)  │
│  HTTP:  Axios → /api/v1/* via proxy to :8000                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/JSON  (Bearer JWT)
┌────────────────────────▼────────────────────────────────────┐
│  BACKEND  (FastAPI / Uvicorn)                               │
│  localhost:8000                                             │
│                                                             │
│  Router → Service → Engine → Provider                       │
│  Resilient cache facade (Redis-ready, in-process fallback)  │
│  Background ingestion + signal-scoring loops                │
│  Swagger UI at /api/docs · ReDoc at /api/redoc              │
└────────────────────────┬────────────────────────────────────┘
                         │ SQLAlchemy async (asyncpg)
┌────────────────────────▼────────────────────────────────────┐
│  DATABASE  (PostgreSQL 16+)                                 │
│  User + password auth (credentials in .env)                 │
│  Default host: localhost:5432                               │
│  Database: StrikfinDB                                       │
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
- Current engines: `options_math` (PCR, max-pain, OI walls, Black-76 greeks/IV, ATM-IV, IV-percentile, net-GEX, gamma-flip, writing posture, ATR/ADX/realized-vol), `synthesizer` (multi-factor bias signal), `short_covering` (post-noon recovery detector), `outcome` (signal-outcome R-multiple evaluation).
  > The earlier standalone `regime` engine/service/router has been removed; bias classification now lives in `synthesizer` and is surfaced through the `/signals` endpoints.

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
| `get_option_chain(instrument_id)` | Generated synthetic chain | Fyers optionchain API (IV + greeks recovered locally via Black-76) |
| `get_futures(instrument_id)` | Synthetic futures | Fyers quotes API (near-month FUT symbol) |
| `get_history(instrument_id, days, resolution)` | Synthetic OHLC candles | Fyers history API (powers ATR/ADX/realized-vol) |
| `get_news_headlines(limit)` | Static fixture list | Mock only (no Fyers news feed) |
| `get_institutional_activity(date)` | Static fixture data | Mock only (no Fyers flow data) |

> The Fyers provider keeps a short in-process TTL cache (`_serve`) so a single dashboard fan-out collapses to one real Fyers call per instrument and never trips the API rate limit; on a live error it serves the last-good live value rather than reverting to mock.

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

Token rotation (single-use):
  POST /auth/refresh
  → Validates refresh token hash in DB
  → Revokes the old refresh token (sets revoked_at)
  → Issues a new access + refresh token pair
```

> **Refresh tokens are single-use.** Because the access token lives only in
> memory, every reload rebuilds the session from the stored refresh token. The
> frontend coalesces all refreshes through one in-flight promise
> (`refreshAccessTokenOnce` in `api/client.ts`; `restoreSession` in
> `lib/session.ts`) so concurrent callers — multiple 401s, the boot-time restore,
> or React StrictMode's double-invoked effects — share a single rotation instead
> of racing it (a race would 401 the second caller and bounce the user to login).

---

## Data Flow: A Single Request (e.g. GET /options/1/metrics)

```
HTTP GET /api/v1/options/1/metrics
  ↓
routers/options.py: options_metrics(instrument_id=1)
  ↓ cache.get_json("opt:metrics:1")           ← resilient cache (see below)
  │   hit  → return cached dict
  │   miss ↓
  OptionsService.get_latest_metrics(1, persist=False)
  ↓ calls
  providers.get_spot(1)          → spot dict
  providers.get_option_chain(1)  → chain dict with rows[]
  ↓ computes (engines/options_math.py)
  pcr_oi · max_pain · oi_walls · atm_strike · atm_iv ·
  iv_percentile · net_gex · gamma_flip · writing_posture
  ↓ builds
  OptionsMetrics Pydantic schema
  ↓ cache.set_json("opt:metrics:1", data, ttl=CACHE_TTL_METRICS)
  ↓ returns JSON response
```

Read endpoints are cached at the **router** and pass `persist=False`; the only
writer of history rows is the background scheduler (`persist=True`). This keeps
a dashboard poll from triggering per-request INSERTs.

---

## Caching Layer (`app/core/cache.py`)

A single resilient facade (`cache.get_json` / `cache.set_json` / `make_key`)
backs every hot read endpoint (`/options/{id}/metrics`, `/options/{id}/chain`,
`/options-lab/oi/{id}`, `/options-lab/oi-series/{id}`).

- **Redis-ready, zero code change.** Leave `REDIS_URL` empty for the built-in
  in-process TTL cache; set it for a shared Redis cache across workers.
- **Correct in every Redis state.** The Redis client is configured to fail fast
  (sub-second connect timeout, no retries). On any Redis error a circuit breaker
  trips and the facade serves from the in-process cache for `REDIS_COOLDOWN`
  (30 s) before re-probing — a down/slow Redis can never add latency to a
  request. Every write is also mirrored to the in-process cache, so the fallback
  is always warm. Running Redis is an optimization, not a dependency.
- TTLs come from `CACHE_TTL_METRICS` / `CACHE_TTL_CHAIN` / `CACHE_TTL_OI`
  (default 30 s, aligned with the UI poll interval).

---

## Background Ingestion & Signal Scoring (`app/ingestion/scheduler.py`)

Two asyncio loops start in the app lifespan when `INGEST_ENABLED=true`:

- **Index loop** — snapshots `index_live_data` every `INGEST_INTERVAL_SECONDS`
  (default 60 s) and persists a full option-chain snapshot roughly every 5 min
  (these power real ATR/ADX/IV-percentile history and the Options Lab intraday
  curves).
- **Scorer loop** — re-scores open AI signals against realised price every
  `SCORER_INTERVAL_SECONDS` (default 900 s) via the `outcome` engine.

Both are gated to NSE/BSE cash hours when `INGEST_MARKET_HOURS_ONLY=true`.

---

## Frontend Route Map

Instrument selection (NIFTY 50 / SENSEX) is held in the `?inst=` query param via
the `useInstrument` hook, so it survives reloads and stays in sync across pages.

| URL path | Page component | Primary API call(s) |
|---|---|---|
| `/` | `LoginPage` | `POST /auth/login`, `POST /auth/register` |
| `/dashboard` | `DashboardPage` | `GET /dashboard` + `GET /options/{id}/metrics` + `GET /options/{id}/chain` |
| `/advanced-dashboard` | `AdvancedDashboardPage` | `GET /dashboard` + `GET /index/{id}/futures` + `GET /options/{id}/metrics` |
| `/options` | `OptionsPage` | `GET /options/{id}/metrics`, `GET /options/{id}/chain` |
| `/option-chain` | `OptionChainPage` | `GET /options/{id}/chain` |
| `/options-lab` | `OptionsLabPage` | `GET /options-lab/oi/{id}`, `GET /options-lab/oi-series/{id}` |
| `/future-lab` | `FutureLabPage` | `GET /index/{id}/futures` |
| `/analyse` | `AnalysePage` | `GET /sentiment/{id}`, `GET /index/{id}/short-covering` |
| `/all-in-1` | `AllInOnePage` | aggregate of the above |
| `/smart-money` | `SmartMoneyPage` | `GET /smart-money/{id}` |
| `/institutional` | `InstitutionalPage` | `GET /institutional` |
| `/copilot` | `CopilotPage` | `POST /copilot/ask` |
| `/settings` | `SettingsPage` | `GET /auth/fyers/status` |

> The standalone `/dashboard` aggregate carries options + chain for **both**
> NIFTY and SENSEX (`nifty_options`/`sensex_options`,
> `nifty_option_chain`/`sensex_option_chain`); for guaranteed instrument-aware
> data the dashboards also fetch the dedicated `/options/{id}/*` endpoints keyed
> on the selected instrument.
