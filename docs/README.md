# Strikfin

Strikfin is an institutional-grade market intelligence terminal for India's benchmark indices — NIFTY 50 and SENSEX — that fuses options open-interest analytics, an Options Lab (intraday OI build-up, multi OI & volume, multistrike OI change, put-call ratio, max pain, and gamma exposure), a multi-factor AI bias signal with outcome scoring, smart-money signal detection, FII/DII flow interpretation, news sentiment scoring, and an AI-grounded copilot into a single, real-time dashboard. Charts run on Apache ECharts; the UI ships four themes (classic / warm / dark / terminal) and DB-backed per-user settings. All outputs carry a mandatory SEBI-aligned disclosure label; the platform is explicitly positioned as market intelligence, not investment advice.

> **Multi-tenant ready.** A tenancy plane (organizations, roles/permissions, memberships, API keys, plans, subscriptions) and per-broker connections back a SaaS deployment path — see [SAAS_MIGRATION_NOTES.md](SAAS_MIGRATION_NOTES.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend framework** | FastAPI 0.115.5 + Uvicorn 0.32.1 |
| **Database** | PostgreSQL 16+ (user/password auth) |
| **Cache** | Resilient facade — in-process by default, optional Redis (`redis-py`) with fail-fast + circuit-breaker fallback |
| **ORM** | SQLAlchemy 2.0 async + asyncpg |
| **Migrations** | Alembic 1.14 |
| **Auth** | JWT (python-jose) + bcrypt password hashing |
| **LLM (optional)** | OpenAI `gpt-4o-mini` or Anthropic `claude-sonnet-4-6` |
| **Market data** | Fyers API v3 (live) or built-in mock provider |
| **Frontend framework** | React 19 + Vite 8 |
| **Routing** | React Router 7 |
| **State management** | Zustand 5 |
| **HTTP client** | Axios 1 |
| **Charts** | Apache ECharts (`echarts` + `echarts-for-react/esm/core`) |
| **Styling** | Tailwind CSS 4 (4-theme CSS-variable remap on `<html>`) |
| **Frontend tests** | Vitest 3 |
| **Language** | TypeScript 6 (frontend) · Python 3.11 (backend) |
| **Backend tooling** | uv (dependency + Python-version management; pinned to 3.11) |

---

## Quick Start

### Prerequisites

- [uv](https://docs.astral.sh/uv/) (manages Python + dependencies; installs Python 3.11 for you)
- Node.js 20+
- PostgreSQL 16+ (any edition; the community server is fine)
- A Postgres role/password and an empty database (e.g. `StrikfinDB`)

### 1. Clone & install backend

```bash
git clone <repo-url>
cd "Strikfin (ATT)/backend"
uv sync               # creates .venv with Python 3.11 and installs all locked deps
```

### 2. Configure environment

```bash
cp .env.example .env   # in backend/ — or create it manually; see ENVIRONMENT_VARIABLES.md
```

Minimum required `.env`:

```ini
SECRET_KEY=your-random-secret-here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=StrikfinDB
DB_USER=postgres
DB_PASSWORD=your-postgres-password
MARKET_DATA_VENDOR=mock
LLM_PROVIDER=none
```

### 3. Run database migrations

```bash
uv run alembic upgrade head
```

### 4. Start the backend

```bash
uv run app.py        # prints the structured startup banner
```

Interactive API docs: <http://localhost:8000/api/docs>

### 5. Install & start the frontend

```bash
cd ../frontend
npm install
npm run dev
```

Frontend: <http://localhost:5173>

---

## Folder Structure

```
Strikfin (ATT)/
├── backend/                    # run uv from here
│   ├── app/
│   │   ├── api/v1/routers/     # FastAPI endpoint handlers
│   │   ├── core/               # Config, security, deps, exceptions, banner
│   │   ├── db/                 # SQLAlchemy models + session
│   │   ├── domain/             # Pydantic request/response schemas
│   │   ├── engines/            # Pure-Python computation engines
│   │   ├── ingestion/          # Market-data providers (mock / Fyers)
│   │   └── services/           # Orchestration layer (provider → engine → DB)
│   ├── tests/unit/engines/     # Engine unit tests
│   ├── tests/unit/services/    # Service unit tests (GEX payload)
│   ├── alembic/versions/       # Database migrations (live history)
│   ├── app.py                  # Launcher — `uv run app.py`
│   ├── pyproject.toml          # Dependencies + Python pin (uv)
│   └── uv.lock                 # Locked dependency versions
├── frontend/
│   └── src/
│       ├── api/                # Typed API client + endpoint functions
│       ├── components/         # Reusable UI components
│       ├── pages/              # Page-level React components
│       ├── stores/             # Zustand state stores
│       └── lib/                # Utility hooks, formatters, pure math (gex.ts + __tests__)
└── docs/                       # This documentation set
```

---

## Documentation Index

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 3-tier diagram, layering rules, provider abstraction |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Full data dictionary, ER diagram, table notes |
| [API_REFERENCE.md](API_REFERENCE.md) | All endpoints, schemas, request/response examples |
| [ENGINES.md](ENGINES.md) | Computation logic, formulas, weights, thresholds |
| [AI_COPILOT_AND_DISCLOSURE.md](AI_COPILOT_AND_DISCLOSURE.md) | Copilot grounding, LLM abstraction, SEBI disclosure |
| [SETUP.md](SETUP.md) | Step-by-step local setup, common errors |
| [RUNNING.md](RUNNING.md) | Day-to-day run & command reference (uv) |
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | Every env var, purpose, example value |
| [TESTING.md](TESTING.md) | Test coverage, how to run tests, known gaps |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Planned features, known limitations |
