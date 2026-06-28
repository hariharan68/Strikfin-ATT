# Local Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.11+ | |
| Node.js | 20+ | |
| PostgreSQL | 16+ | Community server is fine; 18 tested |
| pgAdmin 4 | Latest | Optional — GUI for creating the database |
| Git | Any | |

---

## Step 1: PostgreSQL Setup

### Install PostgreSQL (if not already installed)

Download the installer from [postgresql.org/download](https://www.postgresql.org/download/) (the EDB installer on Windows) and install PostgreSQL 16 or newer.

During installation:
- Set and **remember the password** for the `postgres` superuser — you will put it in `.env`.
- Keep the default port **`5432`** unless another Postgres instance already uses it (the installer will pick `5433` for a second version).
- Optionally install **pgAdmin 4** (bundled in the EDB installer) for a GUI.

### Confirm the port

If you have more than one Postgres version installed, each listens on its own port. In pgAdmin, right-click the server → **Properties → Connection** and note the **Port**. Use that value for `DB_PORT` in `.env`.

### Create the database

**Option A — pgAdmin (GUI):** expand your server → right-click **Databases** → **Create → Database…** → name it `StrikfinDB`, owner `postgres`, **Save**. Leave OID/Tablespace/Comment blank.

**Option B — `psql` / Query Tool:**

```sql
CREATE DATABASE "StrikfinDB";
```

> Keep the double quotes — Postgres folds unquoted identifiers to lowercase, so quoting preserves the capital `S` and `D`.

### No ODBC driver needed

PostgreSQL is reached through the async `asyncpg` driver (installed via `requirements.txt`). There is no ODBC driver or DSN to configure.

---

## Step 2: Backend Setup

```bash
cd "Strikfin (ATT)/backend"

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

---

## Step 3: Environment Configuration

Create a `.env` file in the `backend/` directory:

```ini
# ── Application ───────────────────────────────────────────────
APP_NAME=Strikfin
APP_ENV=development
DEBUG=true

# ── Auth (REQUIRED) ───────────────────────────────────────────
SECRET_KEY=generate-a-random-32-char-string-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# ── Database (REQUIRED) ───────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=StrikfinDB
DB_USER=postgres
DB_PASSWORD=your-postgres-password

# ── Market Data ───────────────────────────────────────────────
# Use "mock" for development; "fyers" requires a valid Fyers token
MARKET_DATA_VENDOR=mock

# ── LLM (optional) ────────────────────────────────────────────
# Use "none" to use the rule-based copilot fallback
LLM_PROVIDER=none
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# ── Fyers (optional — only needed for live market data) ───────
FYERS_CLIENT_ID=
FYERS_APP_ID=
FYERS_SECRET_ID=
FYERS_REDIRECT_URI=http://127.0.0.1:8000/api/v1/auth/fyers/callback
FYERS_ACCESS_TOKEN=

# ── CORS ──────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://localhost:5173
```

### Generate a SECRET_KEY

```python
import secrets
print(secrets.token_hex(32))
```

### PostgreSQL Connection String

The backend builds the connection string from `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` (see `config.py`):

```
postgresql+asyncpg://postgres:your-postgres-password@localhost:5432/StrikfinDB
```

The `DB_USER` role must own — or have `CONNECT`, `CREATE`, and read/write privileges on — the `StrikfinDB` database. The default `postgres` superuser satisfies this out of the box.

### Verify the connection

Start the backend (Step 5) — on a successful connection it logs `✓ Database tables ready`. If the credentials, host, or port are wrong it logs `✗ DB table creation failed … check PostgreSQL connection`.

---

## Step 4: Database Migrations

Alembic is configured but the `alembic/versions/` directory is currently empty — migrations have not been generated yet.

### Generate the first migration from the current models

```bash
cd backend
alembic revision --autogenerate -m "initial_schema"
```

Review the generated file in `alembic/versions/` to verify it matches `db/models.py`.

### Apply migrations

```bash
alembic upgrade head
```

### Roll back one revision

```bash
alembic downgrade -1
```

---

## Step 5: Run the Backend

```bash
cd backend
venv\Scripts\activate

# Development (auto-reload on file change)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Check the API is up:
- Swagger UI: http://localhost:8000/docs
- Health: http://localhost:8000/api/v1/health (if implemented)

---

## Step 6: Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173

The Vite dev server proxies all `/api` requests to `http://localhost:8000` — no CORS configuration needed in dev.

### Frontend build (production)

```bash
npm run build
# Output in frontend/dist/
```

---

## Running in Mock Mode vs Fyers Live Mode

### Mock mode (default, `MARKET_DATA_VENDOR=mock`)

All market data (spot, option chain, futures, news, institutional activity) is generated by `ingestion/providers/mock_provider.py`. Data is synthetic but deterministic enough to exercise all engine logic. No external API calls are made.

This is the recommended mode for development and testing.

### Fyers live mode (`MARKET_DATA_VENDOR=fyers`)

Requires a valid Fyers API app and daily token refresh.

**One-time setup:**
1. Register at [myapi.fyers.in](https://myapi.fyers.in) and create an app.
2. Set `FYERS_APP_ID`, `FYERS_SECRET_ID`, and `FYERS_CLIENT_ID` in `.env`.
3. Set `FYERS_REDIRECT_URI=http://127.0.0.1:8000/api/v1/auth/fyers/callback`.

**Daily token flow:**
1. Start the backend.
2. Navigate to http://localhost:8000/api/v1/auth/fyers/login.
3. Open the returned `login_url` in your browser.
4. Log in with your Fyers credentials — you will be redirected back automatically.
5. The callback endpoint exchanges the `auth_code` for an access token and saves it.
6. Verify: http://localhost:8000/api/v1/auth/fyers/status

**Alternative (manual paste):**
```bash
curl -X POST http://localhost:8000/api/v1/auth/fyers/token \
  -H "Content-Type: application/json" \
  -d '{"access_token": "your_fyers_token"}'
```

> **Note:** Fyers access tokens expire daily. The token must be refreshed each trading day.

---

## Common Setup Errors

### `ModuleNotFoundError: No module named 'asyncpg'`
The Postgres driver isn't installed in the active environment. Activate the venv and run `pip install -r requirements.txt`.

### `password authentication failed for user "postgres"`
`DB_PASSWORD` (or `DB_USER`) in `.env` is wrong. Use the password you set for the role during PostgreSQL install.

### `database "StrikfinDB" does not exist`
The database hasn't been created yet, or the name/casing differs. Create it with `CREATE DATABASE "StrikfinDB";` (keep the quotes to preserve capitals), or fix `DB_NAME` in `.env`.

### `Connection refused` / `could not connect to server`
The PostgreSQL service isn't running or `DB_PORT` is wrong. Start the Postgres service, and if you have multiple Postgres versions installed, confirm the port in pgAdmin (**Properties → Connection → Port**) — a second install commonly uses `5433`.

### `alembic: Target database is not up to date`
Run `alembic upgrade head` from the `backend/` directory with the virtualenv activated.

### `FYERS_NOT_CONFIGURED`
`FYERS_APP_ID` and/or `FYERS_SECRET_ID` are missing from `.env`. These are only needed when `MARKET_DATA_VENDOR=fyers`.
