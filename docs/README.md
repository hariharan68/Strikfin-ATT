# Strikfin

Strikfin is an institutional-grade market intelligence terminal for India's benchmark indices — NIFTY 50 and SENSEX — that fuses options open-interest analytics, regime classification, smart-money signal detection, FII/DII flow interpretation, news sentiment scoring, and an AI-grounded copilot into a single, real-time dashboard. All outputs carry a mandatory SEBI-aligned disclosure label; the platform is explicitly positioned as market intelligence, not investment advice.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend framework** | FastAPI 0.115.5 + Uvicorn 0.32.1 |
| **Database** | Microsoft SQL Server (MSSQL) via Windows Authentication |
| **ORM** | SQLAlchemy 2.0 async + aioodbc / pyodbc |
| **Migrations** | Alembic 1.14 |
| **Auth** | JWT (python-jose) + bcrypt password hashing |
| **LLM (optional)** | OpenAI `gpt-4o-mini` or Anthropic `claude-sonnet-4-6` |
| **Market data** | Fyers API v3 (live) or built-in mock provider |
| **Frontend framework** | React 19 + Vite 8 |
| **Routing** | React Router 7 |
| **State management** | Zustand 5 |
| **HTTP client** | Axios 1 |
| **Styling** | Tailwind CSS 4 |
| **Language** | TypeScript 6 (frontend) · Python 3.11+ (backend) |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Microsoft SQL Server (Express edition is fine) with Windows Authentication enabled
- ODBC Driver 17 for SQL Server

### 1. Clone & install backend

```bash
git clone <repo-url>
cd "Strikfin (ATT)/backend"
python -m venv venv
source venv/Scripts/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env   # or create .env manually — see ENVIRONMENT_VARIABLES.md
```

Minimum required `.env`:

```ini
SECRET_KEY=your-random-secret-here
DB_SERVER=YOURMACHINE\SQLEXPRESS
DB_NAME=StrikfinDB
MARKET_DATA_VENDOR=mock
LLM_PROVIDER=none
```

### 3. Run database migrations

```bash
alembic upgrade head
```

### 4. Start the backend

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive API docs: <http://localhost:8000/docs>

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
├── backend/
│   ├── app/
│   │   ├── api/v1/routers/     # FastAPI endpoint handlers
│   │   ├── core/               # Config, security, deps, exceptions
│   │   ├── db/                 # SQLAlchemy models + session
│   │   ├── domain/             # Pydantic request/response schemas
│   │   ├── engines/            # Pure-Python computation engines
│   │   ├── ingestion/          # Market-data providers (mock / Fyers)
│   │   └── services/           # Orchestration layer (provider → engine → DB)
│   ├── tests/unit/engines/     # Unit tests for engine functions
│   ├── alembic/                # Database migrations
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── api/                # Typed API client + endpoint functions
│       ├── components/         # Reusable UI components
│       ├── pages/              # Page-level React components
│       ├── stores/             # Zustand state stores
│       └── lib/                # Utility hooks and formatters
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
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | Every env var, purpose, example value |
| [TESTING.md](TESTING.md) | Test coverage, how to run tests, known gaps |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Planned features, known limitations |
