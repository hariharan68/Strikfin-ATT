# Changelog

Format: `## vX.Y — Title (YYYY-MM-DD)`
Each entry lists the date, a one-line summary, and the primary files changed.

---

## v0.8 — Gamma Exposure fixes: scaling, walls, gamma-flip, theme visibility (2026-07-17)

Corrected the Options Lab **Gamma Exposure (GEX)** tool to match reference dashboards (StockMojo) and fixed dark/light theme visibility bugs.

- **GEX scaling was 100× too large.** `frontend/src/lib/gex.ts` used the raw `spot²` notional; switched to the industry-standard **per-1%-move** scaling `gamma·OI·lot·spot²·0.01` — every per-strike/aggregate value now matches StockMojo.
- **Call Wall was wrong.** `computeWalls` now uses the SpotGamma definition — Call Wall = strike with the largest **call-side** GEX, Put Wall = largest **put-side** GEX magnitude (was argmax/argmin of *net* GEX).
- **"Show Flip" rendered nothing** on net-short days. Replaced the cumulative-sum `computeGammaFlip` with two correct overlays: **`computeNetGexCross`** (per-strike net zero-cross near spot, orange) and **`computeZeroGamma`** (true zero-gamma *spot*, recomputing gamma at candidate spots + bisection, cyan).
- **Chart centering** — default strike window is a centered ±10, and `chartRows` now trims by symmetric strike-count around the ATM index so All/5/10/20 all stay centered even when the payload is edge-clamped.
- **Theme fixes (inverted-slate).** Time-slider value bubbles (GEX + Open Interest) used `bg-slate-800 text-white` → invisible in dark; now fixed `#1e293b` hex. Light-theme scrollbar retuned from near-white/pure-black to `#cbd5e1`/`#94a3b8` grays (`index.css`). Open Interest "Market Insight" body text switched from inverting `text-slate-600` to the stable `text-primary-800/90` on its light `primary-50` box.

**Files changed:** `frontend/src/lib/gex.ts` (+ `__tests__/gex.test.ts`, now 22 vitest tests), `frontend/src/components/options-lab/GexChart.tsx`, `frontend/src/pages/options-lab/GammaExposureTool.tsx`, `frontend/src/pages/options-lab/OpenInterestTool.tsx`, `frontend/src/index.css`.

---

## v0.7 — Gamma Exposure tool + chart-pref consumption (2026-07-10)

Shipped the Options Lab → **Gamma Exposure** tool (the `gamma-exposure` slug). Backend serves **raw inputs, not results**: `GET /options-lab/gex-series/{id}` (`options_lab_service.get_gex_series`) returns per-snapshot aligned call/put OI + IV arrays per strike plus spot, `expiry_ts`, `risk_free`, `lot_size`; **all GEX math is client-side** in the pure module `frontend/src/lib/gex.ts` (Black-Scholes gamma, per-strike dealer GEX, walls, gamma-flip, regime). Tests: vitest in `src/lib/__tests__/gex.test.ts` + pytest `backend/tests/unit/services/test_options_lab_gex.py`. Added `pythonpath = ["."]` to backend `pyproject.toml` so `uv run pytest` resolves `app.*`.

**Files added:** `frontend/src/lib/gex.ts`, `frontend/src/pages/options-lab/GammaExposureTool.tsx`, `frontend/src/components/options-lab/GexChart.tsx`, `backend/tests/unit/services/test_options_lab_gex.py`.
**Files changed:** `backend/app/services/options_lab_service.py`, `backend/app/api/v1/routers/options_lab.py`.

---

## v0.6 — Settings persistence, tenancy plane, futures overlays (2026-07-06)

- **Settings persistence.** New `user_preferences` table + profile columns on `users`; endpoints `PATCH /auth/me`, `GET/PUT /me/preferences`, `GET /me/plan` (routers `preferences.py`). Frontend `usePreferences` store (mirrors `useTheme`), seeded at login. Chart prefs consumed: `show_chart_tooltip` + `call_put_scheme` (classic/inverted) drive the ECharts tooltip and call/put colours.
- **Multi-tenant (M5) plane.** `organizations`, `roles`, `permissions`, `role_permissions`, `memberships`, `api_keys`, `plans`, `subscriptions` tables + `broker_connections`; router `tenancy.py` (`/me/tenancy`, `/orgs`, `/api-keys`). Alembic migrations `359a6ec8421d`, `a2aa386db8ed`, `20afea002e7e`.
- **Instruments master** — DB-driven `instruments` table + `/instruments`, `/instruments/search` (navbar combobox source).
- **Fyers `quotes()` throttle hardening** — `get_futures` rides the batched `_refresh_all_spots`; chain-derive fallback (`_spot_and_fut_from_chain`) recovers real spot + futures during a `quotes()` 429.
- **Four-theme system** (classic / warm / dark / terminal) via a CSS-variable slate remap on `<html>` — no per-element `dark:` variants.

---

## v0.5 — Options Lab ECharts migration + futures overlays (2026-07-03)

- **Migrated all Options Lab charts to Apache ECharts** (`echarts` + `echarts-for-react/esm/core`): Multi OI & Volume, MultiStrike OI Change (`MultiLineChart.tsx`), and the Open Interest grouped-bar chart (`OpenInterestChart.tsx`) — axis tooltip, crosshair, legend toggles, wheel/drag/slider zoom; the instance is never remounted (`shouldSetOption={() => false}` + `setOption(..., { replaceMerge: ['series'] })`).
- **Price overlays = current-month FUTURES, not index spot.** Added nullable `option_chain_snapshots.future_price` (`> 0` check), captured per snapshot; `OptionsLabService._fut_of` reads it with a spot fallback for pre-column rows.
- **IV forward via put-call parity** (`F = K + (C−P)/disc`) fixed dashboard CE-row IV showing 0.0%; unrecoverable IV renders "—" and is stored NULL (never `iv = 0`, per `ck_ocr_iv`).
- **Data-gap back-fill** — synthetic 09:15 open point reconstructed from day-over-day `oi_change` so morning-gap charts span the full session.

**Files changed (key):** `backend/app/services/options_lab_service.py`, `backend/app/services/options_service.py`, `backend/app/ingestion/providers/fyers_provider.py`, `frontend/src/components/options-lab/MultiLineChart.tsx`, `frontend/src/components/options-lab/OpenInterestChart.tsx`, `docs/postgres_db_creation.sql`.

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
