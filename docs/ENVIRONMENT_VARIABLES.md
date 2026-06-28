# Environment Variables

All settings are loaded from the `backend/.env` file via `pydantic-settings`. The canonical source of truth is `backend/app/core/config.py`. Every module imports `settings` from there — direct `os.environ` reads are not allowed anywhere else in the codebase.

Case-insensitive. Extra variables in `.env` are silently ignored.

---

## Application

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `APP_NAME` | `Strikfin` | No | No | Display name (used in logs) |
| `APP_ENV` | `development` | No | No | `development` or `production` |
| `DEBUG` | `True` | No | No | Enables FastAPI debug mode and verbose errors |

---

## Auth / JWT

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `SECRET_KEY` | — | **Yes** | **Yes** | HMAC secret for JWT signing. Min 32 random characters. |
| `ALGORITHM` | `HS256` | No | No | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | No | No | Access token lifetime in minutes |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | No | No | Refresh token lifetime in days |

**Generate a secret key:**
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Database

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `DB_HOST` | `localhost` | No | No | PostgreSQL server host |
| `DB_PORT` | `5432` | No | No | PostgreSQL server port |
| `DB_NAME` | `StrikfinDB` | No | No | Database name |
| `DB_USER` | `postgres` | **Yes** | No | PostgreSQL role/username |
| `DB_PASSWORD` | — | **Yes** | **Yes** | Password for `DB_USER` |

The `DATABASE_URL` property is assembled at runtime:
```
postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}
```

Authentication uses a standard Postgres role + password (no Windows/ODBC). The async `asyncpg` driver is used — no ODBC driver needs to be installed.

**Multiple Postgres versions note:** if you have more than one Postgres server installed, they listen on different ports (commonly `5432` and `5433`). Set `DB_PORT` to match the instance that holds `StrikfinDB`.

---

## Market Data Provider

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `MARKET_DATA_VENDOR` | `mock` | No | No | `mock` (synthetic data) or `fyers` (live Fyers API) |

`mock` is safe for all development and testing. `fyers` requires valid Fyers credentials and a daily OAuth token refresh.

---

## LLM (AI Copilot)

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `LLM_PROVIDER` | `none` | No | No | `openai`, `anthropic`, or `none` |
| `OPENAI_API_KEY` | `""` | No | **Yes** | Required when `LLM_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | `""` | No | **Yes** | Required when `LLM_PROVIDER=anthropic` |

When `LLM_PROVIDER=none`, the copilot uses the deterministic rule-based fallback (no external API calls, no cost).

The OpenAI integration uses model `gpt-4o-mini`. The Anthropic integration uses model `claude-sonnet-4-6`.

---

## Fyers OAuth

Only relevant when `MARKET_DATA_VENDOR=fyers`. All default to empty string.

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `FYERS_CLIENT_ID` | `""` | Fyers-only | No | Fyers trading account client ID |
| `FYERS_APP_ID` | `""` | Fyers-only | No | Fyers API app ID (from myapi.fyers.in) |
| `FYERS_SECRET_ID` | `""` | Fyers-only | **Yes** | Fyers app secret key |
| `FYERS_REDIRECT_URI` | `http://127.0.0.1:8000/api/v1/auth/fyers/callback` | Fyers-only | No | OAuth callback URL — must match app settings on Fyers portal |
| `FYERS_ACCESS_TOKEN` | `""` | Fyers-only | **Yes** | Today's access token — can be pasted manually or set via OAuth flow |

**Fyers tokens expire daily.** The `FYERS_ACCESS_TOKEN` in `.env` is an optional fallback — the preferred method is the OAuth flow at `/api/v1/auth/fyers/login`.

---

## CORS

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:5173` | No | No | Comma-separated list of allowed CORS origins |

Example for multiple origins:
```ini
ALLOWED_ORIGINS=http://localhost:5173,https://app.strikfin.ai
```

---

## Minimal `.env` for Development

```ini
SECRET_KEY=replace-with-32-char-random-string
DB_HOST=localhost
DB_PORT=5432
DB_NAME=StrikfinDB
DB_USER=postgres
DB_PASSWORD=your-postgres-password
MARKET_DATA_VENDOR=mock
LLM_PROVIDER=none
```

## Full `.env` for Fyers Live + LLM

```ini
SECRET_KEY=replace-with-32-char-random-string
DB_HOST=localhost
DB_PORT=5432
DB_NAME=StrikfinDB
DB_USER=postgres
DB_PASSWORD=your-postgres-password

MARKET_DATA_VENDOR=fyers
FYERS_CLIENT_ID=XY1234
FYERS_APP_ID=XY1234-100
FYERS_SECRET_ID=your_fyers_secret_here
FYERS_REDIRECT_URI=http://127.0.0.1:8000/api/v1/auth/fyers/callback

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

APP_ENV=production
DEBUG=false
ALLOWED_ORIGINS=http://localhost:5173
```
