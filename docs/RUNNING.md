# Running Strikfin

This is the short, day-to-day reference for starting and working with the app.
For first-time machine setup (PostgreSQL, `.env`, etc.) see [SETUP.md](./SETUP.md).

The backend uses **[uv](https://docs.astral.sh/uv/)** to manage both Python (pinned to **3.11**) and dependencies. You never activate a venv or call `pip` — always go through `uv run`. **Run backend commands from the `backend/` folder** — that's where `app.py`, `pyproject.toml`, and `uv.lock` live.

---

## TL;DR

```bash
# Backend  → http://127.0.0.1:8000   (docs at /api/docs)
cd "Strikfin (ATT)/backend"
uv sync                  # first time only (or after dependencies change)
uv run app.py            # prints the structured startup banner

# Frontend → http://localhost:5173
cd ../frontend
npm install              # first time only
npm run dev
```

---

## Backend

| Task | Command |
|------|---------|
| Start the server (auto-reload) | `uv run app.py` |
| Start on a custom host/port | `uv run app.py --host 0.0.0.0 --port 8001` |
| Start without auto-reload | `uv run app.py --no-reload` |
| Install / refresh dependencies | `uv sync` |
| Add a dependency | `uv add <package>` |
| Remove a dependency | `uv remove <package>` |
| Run the test suite | `uv run pytest` |
| Apply DB migrations | `uv run alembic upgrade head` |
| Generate a migration | `uv run alembic revision --autogenerate -m "msg"` |
| One-off Python | `uv run python -c "..."` |
| Show all SQL (debug) | set `SQL_ECHO=true` in `backend/.env`, then restart |
| Regenerate the Fyers daily token | see [Fyers Data Linking.md](./Fyers%20Data%20Linking.md) |

Run these from the `backend/` folder. `uv run app.py` is equivalent to `uvicorn app.main:app --reload`; `app.py` is just a launcher in `backend/`.

Startup prints a structured **rich** banner (app version, endpoints, status). SQL logging is off by default for a clean console — flip `SQL_ECHO=true` in `backend/.env` to see every statement.

### Golden rule

> **Always prefix backend commands with `uv run`.** Never run bare `uvicorn`, `pip`, `python`, or `alembic` — those resolve to the machine's global Python 3.14, which lacks wheels for `asyncpg`/`pydantic-core` and fails with `ModuleNotFoundError: No module named 'asyncpg'`. uv pins 3.11 and prevents this entirely.

---

## Frontend

| Task | Command |
|------|---------|
| Install dependencies | `npm install` |
| Start dev server | `npm run dev` |
| Production build | `npm run build` |

Run these from the `frontend/` directory.

---

## URLs

| Service | URL |
|---------|-----|
| Backend API | http://127.0.0.1:8000 |
| API docs (Swagger) | http://localhost:8000/api/docs |
| Frontend | http://localhost:5173 |

---

## Troubleshooting

**`ModuleNotFoundError: No module named 'asyncpg'`** — you ran a bare command instead of `uv run`. Use `uv run app.py`. If it persists, run `uv sync`.

**`uv: command not found`** — install uv: see [astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/), then reopen the terminal.

**Port already in use** — start on another port: `uv run app.py --port 8001`.

For database/connection and Fyers-token issues, see the *Common Setup Errors* section of [SETUP.md](./SETUP.md).
