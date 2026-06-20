# Environment Variables

All settings are loaded from the `backend/.env` file via `pydantic-settings`. The canonical source of truth is `backend/app/core/config.py`. Every module imports `settings` from there — direct `os.environ` reads are not allowed anywhere else in the codebase.

Case-insensitive. Extra variables in `.env` are silently ignored.

---

## Application

| Variable | Default | Required | Sensitive | Purpose |
|---|---|---|---|---|
| `APP_NAME` | `Alphalytic AI` | No | No | Display name (used in logs) |
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
| `DB_SERVER` | `SRIHARIHARAN\SQLEXPRESS` | **Yes** | No | SQL Server host and optional instance name |
| `DB_NAME` | `AlphalyticDB` | No | No | Database name |
| `DB_DRIVER` | `ODBC Driver 17 for SQL Server` | No | No | ODBC driver string (must match installed driver exactly) |

The `DATABASE_URL` property is assembled at runtime:
```
mssql+aioodbc://@{DB_SERVER}/{DB_NAME}?driver={DB_DRIVER}&Trusted_Connection=yes&TrustServerCertificate=yes
```

No username or password — Windows Authentication (`Trusted_Connection=yes`) is used exclusively.

**Named instance note:** Do not add a port to `DB_SERVER`. Named instances use dynamic port discovery via SQL Server Browser. Adding a port breaks named-instance resolution.

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
ALLOWED_ORIGINS=http://localhost:5173,https://app.alphalytic.ai
```

---

## Minimal `.env` for Development

```ini
SECRET_KEY=replace-with-32-char-random-string
DB_SERVER=YOURMACHINE\SQLEXPRESS
DB_NAME=AlphalyticDB
MARKET_DATA_VENDOR=mock
LLM_PROVIDER=none
```

## Full `.env` for Fyers Live + LLM

```ini
SECRET_KEY=replace-with-32-char-random-string
DB_SERVER=YOURMACHINE\SQLEXPRESS
DB_NAME=AlphalyticDB
DB_DRIVER=ODBC Driver 17 for SQL Server

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
