# Changelog

Format: `## vX.Y — Title (YYYY-MM-DD)`
Each entry lists the date, a one-line summary, and the primary files changed.

---

## v0.1 — Initial Documentation (2026-06-20)

Generated the first complete documentation set covering all layers of the platform as built.

**Files added:**
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/API_REFERENCE.md`
- `docs/ENGINES.md`
- `docs/AI_COPILOT_AND_DISCLOSURE.md`
- `docs/SETUP.md`
- `docs/ENVIRONMENT_VARIABLES.md`
- `docs/TESTING.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

**Platform state at this version:**
- Backend: FastAPI + SQLAlchemy async, PostgreSQL via asyncpg
- Engines: options_math, regime (7-state), synthesizer, short_covering
- Providers: mock (default) + Fyers (live)
- LLM: openai / anthropic / none (rule-based fallback)
- Frontend: React 19 + Vite 8 + Zustand + Tailwind CSS 4
- Auth: JWT + bcrypt + refresh token rotation
- Test suite: file stubs created, no test functions written yet
- Alembic migrations: configured but no version files generated

---

## v0.4 — Instrument-aware dashboards, resilient cache, auth & OI fixes (2026-06-29)

A round of correctness, performance, and UI fixes across both tiers.

**Instrument switching (NIFTY ⇄ SENSEX) fixed.** The Dashboard and Advanced
Dashboard showed NIFTY option metrics/chain even when SENSEX was selected,
because the `/dashboard` aggregate only ever shipped NIFTY's options. The
aggregate now returns both instruments (`nifty_options`/`sensex_options`,
`nifty_option_chain`/`sensex_option_chain`), and the dashboards fetch the
dedicated `/options/{id}/*` endpoints keyed on the selected instrument.

**Resilient cache layer (≈40× faster hot endpoints).** With `REDIS_URL` set but
Redis down, every cached request blocked ~8 s retrying the connection. The cache
facade now fails fast (sub-second connect timeout, no retries), trips a 30 s
circuit breaker, and auto-falls-back to the in-process cache — so a down/slow
Redis can never add latency. `/options/*` went from ~8 s to ~0.2 s.

**Reload-logout fixed (single-use refresh tokens).** A page reload could bounce
the user to the login screen: React StrictMode double-invoked the boot restore,
firing two refreshes with the same single-use token (one 200, one 401). All
refreshes are now coalesced through one in-flight promise.

**Options Lab — Open Interest chart redesigned** to match the reference UI
(StockMojo): vivid wider Call/Put bars with hatched "increase" / dashed
"decrease" segments, Max-Pain/Spot reference chips, and a richer hover card. The
chart canvas follows the app theme (dark in dark themes, white in light) while
the bars stay identical.

**Options Lab — Multi OI & Volume fixed.** A single live snapshot produced a
blank line chart; the series endpoint now synthesizes a 09:15 "open" point from
the day-over-day OI change so an open→now curve always draws.

**Removed** the floating "Ask Copilot" button from the global layout.

**Files changed (key):**
- `backend/app/core/cache.py` — fail-fast Redis + circuit breaker + in-process fallback
- `backend/app/api/v1/routers/dashboard.py` — return both instruments' options/chain
- `backend/app/services/options_lab_service.py` — synthetic 09:15 open point
- `frontend/src/api/client.ts`, `frontend/src/lib/session.ts`, `frontend/src/App.tsx` — coalesced refresh / session restore
- `frontend/src/pages/DashboardPage.tsx` — per-instrument options/chain fetches
- `frontend/src/components/options-lab/OpenInterestChart.tsx` — redesigned, theme-aware

---

## v0.3 — Structured startup banner + clean logs (2026-06-29)

`uv run app.py` (run from `backend/`) now prints a clean, boxed **rich** banner — app
version, endpoints (API / Swagger / ReDoc / Health), ENV·vendor·LLM, and a Ready
status — instead of noisy output. SQL echo is decoupled from `DEBUG` and off by default.

**Files added:**
- `backend/app/core/banner.py` — rich startup banner (forces UTF-8 stdout for Windows)

**Files changed:**
- `backend/app.py` — launcher forces UTF-8 stdio + sets `PYTHONUTF8`, exports host/port for the banner
- `backend/pyproject.toml` — added `rich`
- `backend/app/core/config.py` — added `APP_VERSION`, `SQL_ECHO`
- `backend/app/db/session.py` — `echo` now driven by `SQL_ECHO` (not `DEBUG`)
- `backend/app/main.py` — banner wired into lifespan; quiets `urllib3`/`httpx`/`sqlalchemy.engine` logs
- `.gitignore` — ignore `.venv/`/`venv/`/`__pycache__/` (keep `uv.lock`)

**Note:** set `SQL_ECHO=true` in `backend/.env` to restore full SQL logging.

---

## v0.2 — Backend migrated to uv (2026-06-29)

Replaced the pip + manual-venv workflow with [uv](https://docs.astral.sh/uv/). Python is now pinned to 3.11 in `pyproject.toml`, so the recurring `ModuleNotFoundError: No module named 'asyncpg'` (caused by the global Python 3.14) can no longer occur. The server now starts with a single command: `uv run app.py`.

**Files added:**
- `backend/app.py` — launcher invoked by `uv run app.py`
- `backend/uv.lock` — locked dependency versions (committed)
- `docs/RUNNING.md` — quick run/command reference

**Files changed:**
- `backend/pyproject.toml` — populated with all deps + `requires-python = ">=3.11,<3.12"`
- `backend/app/main.py` — run-instructions docstring
- `docs/README.md`, `docs/SETUP.md`, `docs/TESTING.md`, `docs/Fyers Data Linking.md` — commands switched from `pip`/`venv`/`uvicorn` to `uv sync` / `uv run`

**Note:** `requirements.txt` is superseded by `pyproject.toml` + `uv.lock`.

---

<!-- Add new entries above this line in reverse chronological order -->
<!-- Format:
## vX.Y — Short title (YYYY-MM-DD)

Summary of what changed and why.

**Files changed:** list key files
-->
