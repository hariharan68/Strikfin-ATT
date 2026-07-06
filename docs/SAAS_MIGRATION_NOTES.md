# StrikeFin → Generic SaaS Platform — Migration Notes

**Status:** M0 ✅ · M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅ · M5 ✅ · **M6 in progress** (WebSockets ✅ · Alerts/Scanner/Strategy/… next)
**Last updated:** 2026-07-05

> **The core platform (M0–M5) is complete: multi-instrument, multi-broker, multi-tenant.** M6+ is breadth — additive feature modules on the finished core. **First shipped: real-time WebSocket live feeds.**

> **As of M3 the backend, and as of M4 the frontend, support any instrument.** Add a row to the `instruments` table → it appears in the catalog/search and flows through the whole app with no code change.
**Related:** full 24-section architecture in the approved plan (`snoopy-shimmying-zephyr.md`); this doc is the running engineering log.

---

## 1. The big picture — what we are trying to achieve

StrikeFin today is a **working live terminal hardwired to exactly two instruments** — NIFTY 50 (`instrument_id=1`) and SENSEX (`instrument_id=2`). The goal is to turn it into a **generic, multi-tenant SaaS trading-intelligence platform** that supports *any exchange, any broker, any instrument* (think TradingView / Sensibull / Bloomberg-class), **without throwing away the working app or the finished React UI**.

The key realization that shapes everything: **the coupling is not in the database.** The `instruments` table already exists and every market table already has an `instrument_id` foreign key; the API paths are already `/{id}/...`. The NIFTY/SENSEX assumptions live almost entirely in **hardcoded Python/TypeScript constants** — dictionaries like `{1: "NSE:NIFTY50-INDEX", 2: "BSE:SENSEX-INDEX"}`, `LOT_SIZE = {1: 65, 2: 20}`, the tuple `_INSTRUMENTS = (1, 2)`, the route guard `Path(ge=1, le=2)`, and the frontend type `InstrumentId = 1 | 2`.

That makes this a **refactor, not a rewrite** — which is why we chose the **incremental "strangler" strategy**: keep the app live and generalize it module by module. Each milestone ships independently and leaves the terminal working.

### Locked decisions (chosen with the user)
| Decision | Choice | Why |
|---|---|---|
| Migration strategy | **Incremental strangler** | App stays live; lowest risk; continuous value |
| Multi-tenancy | **Shared DB + `tenant_id` + Postgres RLS** | Cheapest, scales to thousands of tenants; market data stays global |
| MVP scope | **Generic core + multi-instrument** | The true unlock — makes the existing feature set work for any instrument |
| Target market | **India first** (NSE/BSE/MCX/CDS; Fyers → Zerodha → Angel → Dhan → Upstox) | Matches current data source, fastest path to revenue |

### Two data planes (the mental model for the whole redesign)
- **Global / reference plane** (no tenant): instruments, exchanges, all market snapshots, news, system signals. Market data is *not* customer-specific, so it is shared across all tenants.
- **Tenant plane** (`tenant_id` + RLS): organizations, users, watchlists, alerts, strategies, portfolios, broker connections. Isolated per customer.

---

## 2. What has been done — Milestone M0 (Foundations)

M0 lays the plumbing everything else depends on, **with zero behavior change** to the running app. Three deliverables.

### 2.1 Alembic wired for real + an authoritative baseline migration

**Problem:** The project *claimed* to use Alembic, but `alembic.ini` and `alembic/env.py` were **empty 0-byte files**. Schema was actually managed by `Base.metadata.create_all()` in dev only — which can create tables but can **never alter** an existing one. There was no versioned migration path, so no safe way to evolve the schema for the SaaS work ahead. This was the single hardest blocker.

**What we did:**
- Wrote a real `alembic.ini` that **deliberately leaves the DB URL blank** — `env.py` injects `settings.DATABASE_URL` at runtime, so credentials live only in `backend/.env`.
- Wrote an **async `env.py`** (asyncpg + `run_sync` bridge) that imports `Base.metadata` with all models, so `--autogenerate` sees the full schema.
- Generated the **baseline migration** (`5a2843c19f71`, "baseline current schema") and then **hardened it beyond what autogenerate produces**. Autogenerate only captures ORM-defined structure — it **missed the CHECK constraints and views that lived only in `docs/postgres_db_creation.sql`**. A fresh DB built from the raw autogenerate output would have **lacked `ck_ocr_iv`** (the constraint that prevents persisting `iv = 0` and corrupting OI history) — unacceptable. We pulled the exact definitions from the live database and added them to the baseline:
  - **26 CHECK constraints** (`ck_ocr_iv`, `ck_ocs_future_price`, `ck_ild_prices`, `ck_ms_score`, …)
  - **3 views** (`vw_latest_index_snapshot`, `vw_latest_option_snapshot`, `vw_daily_institutional_summary`)
  - **2 maintenance functions** (`fn_cleanup_expired_tokens`, `fn_purge_old_snapshots`)
- **Found and fixed a real latent bug** in the process: `instruments.instrument_id` was being created as an **auto-increment `integer` with a sequence**, but the live/intended design is a **manually-assigned `smallint`** (ids are hand-assigned: 1 = NIFTY, 2 = SENSEX). SQLAlchemy silently promotes a lone integer PK to SERIAL on Postgres. Fixed with `autoincrement=False` in **both** the migration and the ORM model (`app/db/models.py`), so a fresh `create_all` or `upgrade` now matches the live schema exactly.

**Intent / what this achieves:** Alembic is now the **single source of truth** for schema. `alembic upgrade head` on an empty database reproduces the exact production schema — including the safety-critical constraints. Every schema change from here on (the rich instrument columns in M1, the tenant tables in M5) is a **versioned, reviewable, reversible migration** instead of a hand-edited SQL file.

**Verification (all passed):**
- Baseline ran **up → down → up** cleanly on a throwaway DB (idempotent).
- `alembic check` against a migration-built DB reports **"No new upgrade operations detected"** (ORM ↔ migration in sync).
- Constraint / view / function parity with the live DB is **26 / 26, exact** (verified by querying `pg_constraint` on both).
- The **live `StrikfinDB` was stamped** to the baseline (`alembic current` → `5a2843c19f71 (head)`). Stamping is non-destructive — it inserts one row into a new tiny `alembic_version` table and runs **no DDL** against production data.

### 2.2 `InstrumentRef` — the resolved instrument value object (`app/instruments/`)

**Problem:** Instrument identity flows through the whole app as a **bare int** (1 or 2), and every layer re-derives that instrument's properties from its own hardcoded dict (symbols, lot size, strike step, futures-symbol builder). Adding a third instrument today means editing ~8 different dictionaries and a route guard.

**What we did:** Introduced `InstrumentRef` — an **immutable, cached value object** that describes one instrument, loaded once from the `instruments` table:
- Carries today's columns (`symbol`, `exchange`, `lot_size`, `is_active`) **plus M1-ready optional fields** (`display_name`, `segment`, `instrument_type`, `underlying`, `tick_size`, `strike_step`, `expiry_rule`, `vendor_symbols`). Consumers can start depending on the object now; M1 fills the optional fields with no consumer changes (uses `getattr`, so new model columns flow through automatically).
- `resolve_instrument(db, id)` is **read-through cached** over the existing Redis-or-in-process cache facade, and **raises `InstrumentNotFound`** for unknown/inactive ids (→ clean 404 instead of silently serving a hardcoded default).
- `resolve_active_instruments(db)` returns all active instruments — the future replacement for the hardcoded `(1, 2)` tuples in the scheduler and dashboard.

**Intent / what this achieves:** One place to ask "what is this instrument?" So when M1/M2/M3 delete the hardcoded dicts, the replacement is `ref.lot_size` / `ref.vendor_symbol("fyers")` / `ref.strike_step` — DB-driven, not magic-number-keyed.

**Verification:** Live-tested against the real DB — resolves instruments 1 & 2 with correct symbol/exchange/lot, serves the second lookup from cache, and raises `InstrumentNotFound` for id 99. (The Redis timeout seen during the test is **expected and benign** — `REDIS_URL` is configured but Redis wasn't running, so the cache facade's circuit breaker degraded to the in-process cache exactly as designed; every resolve still succeeded.)

### 2.3 `TenantContext` — request-scoped tenant identity (`app/tenancy/`)

**Problem:** The app is single-user with no notion of organizations/tenants — a hard blocker for SaaS isolation, and something we don't want to retrofit by adding a `tenant_id` argument to hundreds of function signatures later.

**What we did:** Added a **contextvar-based `TenantContext`** (tenant_id, user_id, roles) plus a FastAPI dependency that binds it per request and resets on exit. For now it uses a single implicit tenant (`DEFAULT_TENANT_ID`), so **behavior is unchanged**. Any service can already call `current_tenant()` without a tenant argument.

**Intent / what this achieves:** In M5, `TenantContext` gains a real organization id from the JWT and additionally issues `SET app.tenant_id = :id` on the DB session, so **Postgres Row-Level Security** enforces isolation even if a query forgets a `WHERE tenant_id = …`. Building the carrier now means M5 is a fill-in, not a refactor.

### 2.4 Wiring (additive, no behavior change)
`core/deps.py` gained three dependencies — `get_instrument_ref` (resolves a path `instrument_id` → `InstrumentRef` or 404), `get_tenant_context`, and `get_optional_user_id` (a non-raising auth check) — exposed as `InstrumentRefDep`, `TenantCtx`, `OptionalUserId`. **Nothing is force-wired into existing routes** — today's routes use `{id}` path params, not `{instrument_id}`, so nothing auto-binds. M3 renames the params to adopt these. The app boots with all 34 routes intact and no import cycles.

---

## 2b. What has been done — Milestone M1 (Instrument Master)

M1 turns the 5-column reference `instruments` table into a **rich master that is the single source of truth for what an instrument is**, and exposes it over an API. The two built-in indices now render from DB data, not hardcoded dicts.

### 2b.1 Extended the `instruments` table (migration `debc9e15fc9b`)
Added 11 columns via a versioned Alembic migration (the first real schema change on top of the M0 baseline): `uid` (UUID, server-generated, unique — the opaque external id the frontend will key off), `display_name`, `segment`, `instrument_type`, `underlying`, `tick_size`, `strike_step`, `expiry_rule`, `vendor_symbols` (JSONB), `snapshot_enabled`, `status`. The migration also **backfills the NIFTY/SENSEX rows** with their full data.
- **Gotcha hit and solved:** the initial attempt also widened `symbol` VARCHAR(20)→(40); Postgres refused because `vw_latest_index_snapshot`/`vw_latest_option_snapshot` depend on that column. Since `symbol` is the short *root* symbol (fits in 20; long per-contract strings will be a separate `trading_symbol` column later), we reverted the widen rather than drop/recreate the views — simpler and lower-risk.
- **Verified:** migration runs up → `alembic check` clean → down → up (idempotent) on a throwaway DB, then **applied to the live StrikfinDB** (`alembic current` → `debc9e15fc9b`). Rich data confirmed present via `InstrumentRef`.

### 2b.2 Moved the hardcoded data into the DB (`app/instruments/seed.py` + importer)
The values that were scattered across `fyers_provider` (`_SPOT_SYMBOLS`, `_OPTION_SYMBOLS`, the last-Thursday futures builder), `mock_provider._STEP`, `options_math.LOT_SIZE`, and `options_lab_service._SYMBOLS` now live in **one canonical seed** (`DEFAULT_INSTRUMENTS`). `vendor_symbols` holds the per-vendor symbol map, e.g. `{"fyers": {"spot": "NSE:NIFTY50-INDEX", "option": "…", "futures_template": "NSE:NIFTY{yy}{mon}FUT"}}`, and `expiry_rule` holds `MONTHLY_LAST_THU`. A reusable `upsert_instruments()` importer (idempotent) is what the startup seed calls and what future "add an instrument" flows will use — adding an instrument is now a data operation, not a code change.
> **Note:** the provider dicts themselves are **not deleted yet** — the sync provider functions have no DB session on their hot path. They are removed in **M2**, when the async, DB-aware Market Data Service wraps them and reads `InstrumentRef`. M1's job was to make the DB the source of truth and expose it; M2/M3 flip the consumers over.

### 2b.3 `InstrumentRef` fully populated + read services + catalog API
- `InstrumentRef` now carries every master field (incl. `uid`, `snapshot_enabled`, `status`), coerces DB `Decimal`→`float`, and has a `vendor_symbol(vendor, kind)` helper. Cache serialization roundtrip is lossless (verified).
- `app/instruments/service.py` adds `list_instruments`, `search_instruments` (case-insensitive over symbol + display_name), and `get_instrument`.
- **New router** `GET /instruments`, `GET /instruments/search?q=`, `GET /instruments/{id}` (thin, auth-required, DB-driven). This is the endpoint that replaces the frontend's hardcoded 2-item `INSTRUMENTS` array in M4.
- **Verified end-to-end** (ASGI): catalog returns both instruments with rich data; search by "sens"/"nif" resolves correctly; unknown id → 404; no-auth → 401. App boots with 37 routes (was 34).

### 2b.4 Deliberately deferred (reconsidered from M0)
The **naming-convention cleanup** for the cosmetic `uq_*` constraint-name drift is **not** being done as part of feature milestones. Adding a global metadata `naming_convention` would force autogenerate to rename *every* FK/PK/index (live uses `fk_ild_instrument` etc. from the hand-written SQL) — a large, risky rename migration for zero functional gain. It's parked for a dedicated schema-hygiene pass. The drift is purely cosmetic (identical uniqueness enforced).

---

## 2c. What has been done — Milestone M2 (Broker Adapter + Market Data Service)

M2 inserts the **broker abstraction seam**: a uniform `BrokerAdapter` interface, a broker-agnostic Market Data facade, and durable **encrypted** token storage — so the app can talk to any broker/vendor through one interface, and the Fyers token is no longer a single global in `.env`. Built additively (strangler): the new layer sits *alongside* the live provider path, which M3 then rewires onto it.

### 2c.1 `BrokerAdapter` interface + Fyers/Mock adapters + registry (`app/brokers/`)
- `brokers/base.py` — the `BrokerAdapter` ABC. Every method takes an **`InstrumentRef`** (never a bare int/vendor string) and returns the **same dict shapes** the app already consumes (so M3 rewiring is shape-neutral). Read surface: `get_spot`, `get_option_chain`, `get_futures`, `get_history`, plus a default `get_open_interest` that derives from the chain. Trading methods (`get_positions/orders/holdings/place_order`) are declared and raise `NotImplementedError` — reserved for a later phase.
- `brokers/fyers/adapter.py` — `FyersAdapter`, **delegates to the existing `fyers_provider`** (the strangler wrapper). This deliberately preserves the hard-won rate-limit fix (batched `_refresh_all_spots` + last-good fallback) untouched. Symbol resolution stays in the provider for now; it moves into the adapter (reading `ref.vendor_symbols["fyers"]`) in M3 when the provider dicts are deleted.
- `brokers/mock/adapter.py` — `MockAdapter`, wraps `mock_provider`; the always-available dev/fallback source.
- `brokers/registry.py` — `get_market_data_adapter(ref)` resolves the adapter (M2: global `MARKET_DATA_VENDOR`; the signature already takes `ref` so per-instrument/per-user resolution can be added later with no call-site change). Adapters are cached.

### 2c.2 Market Data Service facade (`app/market_data/service.py`)
- `MarketDataService` (singleton `market_data`) — the **one** async facade the app calls for quotes/chain/futures/OI/history. It resolves the adapter via the registry and runs the **sync adapter call in a threadpool** (`run_in_threadpool`) so a vendor SDK never blocks the event loop. Two call styles: `get_spot(ref)` (preferred; pairs with the `get_instrument_ref` dependency) and `spot_by_id(db, id)` (for the scheduler / id-only callers).
- **Verified:** routes through the configured vendor, returns the provider's dict shape unchanged, derives OI correctly (PCR computed from chain rows).

### 2c.3 Encrypted per-user broker tokens (`broker_connections`) — retiring the global token
- **New table** `broker_connections` (migration `a2aa386db8ed`): `id` UUID, `user_id` (FK, nullable — the OAuth redirect is unauthenticated, so today's row is the implicit global connection; M5 makes it per-user), `broker`, `access_token_enc`/`refresh_token_enc` (**Fernet-encrypted**), `meta` JSONB, `status`, timestamps.
- `brokers/connections.py` — encrypt/decrypt (Fernet key from `BROKER_TOKEN_ENC_KEY`, or **derived from `SECRET_KEY`** so no new required env var), async `save/get/revoke_broker_token`, and `load_fyers_token_into_store` (startup hydration).
- **Wiring:** the Fyers OAuth callback + manual-set routes now persist the token to the DB (encrypted) in addition to the in-memory hot path; `main.py` lifespan hydrates the in-memory store from the DB on boot. **Result: a restart no longer depends on the `.env` token** — the durable source is the encrypted DB row. The sync `token_store` stays as the fast in-memory hot-path cache (the provider reads it on every call); `.env` write is kept only as a legacy fallback.
- **Verified end-to-end:** encrypt→decrypt roundtrip; DB save→get returns the right plaintext; startup hydration loads the DB token into `token_store`; **confirmed the stored value is ciphertext, not plaintext**; app boots cleanly (seed + hydration + background jobs), `/health` green, `/instruments` routes live.

> **Scope honesty:** M2 is the *abstraction + durable-token* layer. The live request path still calls `ingestion.providers.*` directly and the provider dicts still exist — **M3** flips routers/services/scheduler onto `market_data` + `InstrumentRef` and deletes those dicts. "Per-user" broker tokens are modeled now but there is still only one real user until **M5**.

---

## 2d. What has been done — Milestone M3 (De-hardcode the API)

M3 is the milestone where it all comes together: the routers, services, engines, providers and scheduler are cut over to the Instrument Master, and **every remaining hardcoded NIFTY/SENSEX constant is deleted**. After M3 the live request path no longer contains a per-id symbol/lot/step dict, an instrument tuple, or a `le=2` guard.

### 2d.1 The enabling piece — a sync instrument snapshot (`app/instruments/snapshot.py`)
The market-data providers are **synchronous** and run with no DB session, so they can't `await` the async resolver. `snapshot.py` is a plain in-process dict of `InstrumentRef`s that async code hydrates from the DB (at startup, each scheduler cycle, and it lazily self-seeds from `DEFAULT_INSTRUMENTS` if hit pre-hydration). Sync callers read symbols / `strike_step` / `lot_size` / `expiry_rule` from it. Sync helpers: `get`, `all_active`, `snapshot_enabled_ids`, `lot_size`, `strike_step`.

### 2d.2 Generic expiry engine (`app/market_data/expiry.py`)
Replaced the hardcoded last-Thursday futures builder with a rule-driven engine. `current_futures_month(expiry_rule)` interprets `MONTHLY_LAST_THU`/`_TUE`/`_WED`/`_DAY`/… and `build_futures_symbol(ref)` fills the instrument's `vendor_symbols[...]["futures_template"]`. **Regression-checked: produces byte-identical symbols** to the old builder for NIFTY (`NSE:NIFTY26JULFUT`) and SENSEX (`BSE:SENSEX26JULFUT`).

### 2d.3 Providers refactored — dicts deleted
- `fyers_provider.py`: **removed** `_SPOT_SYMBOLS`, `_OPTION_SYMBOLS`, `_SYMBOLS`, `_ALL_INSTRUMENTS`, and the id-branching futures builder. New helpers (`_spot_symbol`, `_option_symbol`, `_display`, `_strike_step`, `_spot_instrument_ids`, `_near_month_futures_symbol`) read the snapshot. The **batched `_refresh_all_spots` rate-limit fix is preserved** — it now builds its one quotes() call from the snapshot's active instruments + their Fyers symbols. ATM fallback uses `strike_step`, not `round(spot/50)`.
- `mock_provider.py`: symbol + strike step now come from the snapshot; only the synthetic price bases remain as dev-only fixtures.

### 2d.4 Engine + services de-hardcoded
- `options_math.py`: **deleted `LOT_SIZE = {1:65, 2:20}`**; `atm_strike(spot, strikes, step)` takes the step. `net_gex` already took `lot_size` explicitly.
- `options_service.py` / `options_lab_service.py`: `LOT_SIZE.get(id)` → `snapshot.lot_size(id)` (6 sites); `options_lab_service._SYMBOLS` dict (7 sites) → `snapshot.get(id).label`.

### 2d.5 Routers, scheduler, dashboard
- **Removed every `Path(ge=1, le=2)` guard** (14 routes across 7 routers) → `ge=1`. An unknown id no longer 422s at validation. (*Known follow-up:* a clean 404 for unknown ids via the `get_instrument_ref` dependency is a nice-to-have; the frontend only ever sends valid catalog ids.)
- `index.py` local `_SYMBOLS` dict → snapshot helper.
- `scheduler.py`: **deleted `_INSTRUMENTS = (1, 2)`** → iterates `snapshot.snapshot_enabled_ids()` and refreshes the snapshot each cycle (new/toggled instruments propagate with no restart).
- `dashboard.py`: was the most coupled — hardcoded `_build_index_card(1)` + `(2)` and `nifty_*`/`sensex_*` response keys. Now iterates **all active instruments** into a generic `instruments` list and a generic AI summary, **with a back-compat shim** still emitting `nifty`/`sensex`/`*_signal`/`*_option_chain`/`*_options` so the current (pre-M4) frontend keeps working. The shim drops in M4.
- `copilot.py` (`"NIFTY50" if id==1 else "SENSEX"`) and `fyers_auth.py` debug-chain (`"NSE:NIFTY50-INDEX" if id==1 …`) → snapshot symbol lookup.

### 2d.6 Verified
- Residual-coupling grep: **no hardcoded instrument dicts / tuples / `le=2` / id-ternaries** remain on the request path (only benign comments, docstrings, and the sanctioned seed).
- Full boot: instruments seeded → snapshot hydrated (2 active) → background jobs up → `/health` green.
- `/dashboard` returns the generic `instruments` list (`[NIFTY 50, SENSEX]`) **and** the back-compat `nifty`/`sensex` keys; generic AI summary reads correctly.
- `index/{1,2}/snapshot` return correct symbols from the master; **`index/5/snapshot` returns 200, not 422** (the `le=2` guard is gone). Expiry engine parity confirmed. Providers fall back to mock cleanly when the Fyers token is absent, exercising the new snapshot-based symbol resolution.

---

## 2e. What has been done — Milestone M4 (Frontend generalization)

M4 generalizes the React app so a user can select **any** instrument, while keeping the existing UI visually intact. It also introduces React Query as the caching layer.

### 2e.1 Dynamic instrument model + catalog API (`api/endpoints.ts`)
- **`InstrumentId` widened from the closed `1 | 2` union to `number`** — the single most impactful type change. `tsc -b` stays clean (the old `=== 2` / `getFutures(1)` sites still typecheck).
- Added the `InstrumentMeta` type (mirrors backend `InstrumentOut`) + `getInstruments()` / `searchInstruments()` clients, and a `toInstrument()` mapper. The static `INSTRUMENTS` array is kept **only as an offline seed / fallback** so the UI never blanks while the catalog loads.
- Added `instruments?: DashboardInstrumentEntry[]` to `DashboardData` (the generic M3 shape).

### 2e.2 React Query (`lib/queryClient.ts`, `lib/useInstruments.ts`, `main.tsx`)
- Installed `@tanstack/react-query`; wrapped the app in `QueryClientProvider`.
- `useInstruments()` — the live catalog, cached (5-min stale), falling back to the seed. `useInstrumentSearch(q)` — the palette query (backend returns the catalog head for an empty query). This is the first cache-backed data layer; existing pages keep their `useFetch` and migrate incrementally.

### 2e.3 Global instrument search + catalog-driven tabs
- **`components/InstrumentSearch.tsx`** — a combobox in the navbar (click → type → pick) hitting `/instruments/search`, the primary way to switch to any instrument. Sets `?inst=`.
- **`InstrumentTabs`** is now catalog-driven (was a hardcoded NIFTY/SENSEX pair): shows up to `max` instruments from the live catalog and always includes the selected one; the long tail lives in search.
- **`useInstrument`** accepts any positive integer id (was `params.get('inst') === '2' ? 2 : 1`).

### 2e.4 Generic dashboard (`pages/DashboardPage.tsx`)
- The focused-instrument label, card, and signal now come from the generic `data.instruments` list + the live catalog (falling back to the legacy `nifty`/`sensex` fields). So selecting a 3rd instrument focuses its panels correctly. The two reference metric cards (NIFTY/SENSEX) are unchanged — the layout is visually identical for the default setup.

### 2e.5 Verified
- **`tsc -b --force` → exit 0** (no type errors from the `number` widening or new modules).
- **`npm run build` → success** (2529 modules).
- **Vite dev server boots clean** (HTTP 200, react-query re-optimized, no ESM resolution errors — the documented `echarts-for-react` dev gotcha is unaffected).
- Backend endpoints it consumes (`/instruments`, `/instruments/search`, generic `/dashboard`) were verified live in M1/M3.

> **Scope honesty:** most pages still use `useFetch` (only the catalog/search use React Query) — full page migration is incremental and non-blocking. `AdvancedDashboardPage`'s side-by-side NIFTY/SENSEX **futures** comparison is left as a designed two-index reference view. A live browser click-through (search → pick an instrument → panels update) is the recommended final manual check — see §10.

---

## 2f. What has been done — Milestone M5 (Multi-tenant SaaS)

M5 turns the single-user app into a multi-tenant SaaS: organizations, memberships, roles/permissions, API keys, subscription plans, RLS, and org/role-aware auth — **without breaking the existing login flow**.

### 2f.1 Tenant schema + seed + RLS (migration `359a6ec8421d`)
- 8 new tables (UUID PKs, audit/soft-delete): `organizations`, `memberships`, `roles`, `permissions`, `role_permissions`, `api_keys`, `plans`, `subscriptions`.
- **Seeded reference data**: 4 roles (owner/admin/analyst/viewer), 13 permissions, 37 role→permission grants, 4 plans (free/pro/desk/enterprise with JSON limits). Owner gets all 13; viewer gets the 4 read perms.
- **Postgres RLS** enabled on the 4 org-scoped tables with policies keyed on `current_setting('app.tenant_id')` (with a permissive branch for system/bootstrap queries). ⚠️ **The app currently connects as a superuser DB role, which bypasses RLS** — so **app-layer scoping** (queries filtered by user/org) is the primary enforcement today; the RLS policies are deploy-ready and enforce once the app runs under a dedicated non-superuser role.

### 2f.2 Fixed a create_all/Alembic conflict (important)
While applying M5, we found the live DB in an inconsistent state: dev-mode `Base.metadata.create_all` had created the ORM tables **ahead of** the migrations, so `alembic upgrade` failed on "already exists" and the migrations' seed/RLS never ran (`alembic_version` was stale). Reconciled by dropping the (empty) tables and re-running migrations cleanly. **Root-cause fix:** `main.py` startup now runs **`alembic upgrade head`** (programmatically, in a thread) instead of `create_all` — so dev and prod both go through migrations and this can't recur. `create_all` is retired from the request path.

### 2f.3 Org provisioning + org/role-aware JWT + TenantContext
- `tenancy/org_service.py`: `provision_personal_org` (every user gets a personal org as owner), `create_org` (team orgs), `resolve_active_org` (active org + role + effective permissions), `list_user_orgs`/`list_members`/`is_member`.
- **Register** provisions a personal org; **login/refresh** resolve the active org and mint the token with `org` + `role` claims. **Pre-M5 users are provisioned lazily on next login** — so existing accounts and in-flight tokens keep working (claims are optional; the tenant dependency falls back to a DB lookup).
- `TenantContext` now carries `tenant_id` (active org), `role`, and effective `permissions`. `get_tenant_context` resolves them and sets the transaction-local `app.tenant_id` RLS var.

### 2f.4 Authorization + SaaS endpoints
- `require_permission("x")` / `require_role("x")` FastAPI dependencies (403 on miss).
- New tenancy router: `GET /me/tenancy`, `GET/POST /orgs`, `GET /orgs/{id}/members`, `GET/POST/DELETE /api-keys` (API keys are org-scoped, `apikey.manage`-gated, hashed at rest, raw key shown once).

### 2f.5 Verified
- Migration up → `alembic check` clean → down → up (idempotent); **applied to live** (seed: 4 roles / 13 perms / 37 grants / 4 plans; RLS on 4 tables; `alembic current` → `359a6ec8421d`).
- End-to-end (ASGI): register → **personal org provisioned**; login → **token carries `org` + `role=owner`**; `/me/tenancy` → role owner, **13 permissions**, 1 org; create team org → 2 orgs; create API key → `sk_live_…` returned once; list keys → 1. **44 routes** (was 37).
- Real uvicorn boot: **startup Alembic upgrade runs clean, zero errors**, `/health` 200.

> **Scope honesty:** billing is modeled (plans/subscriptions tables + a manual-provider default) but the **live Razorpay integration is deferred** — no external payment calls yet. RLS enforcement needs the non-superuser DB role in production (app-layer scoping covers it now). OAuth/Google login and 2FA are not in M5 (the plan lists them as later).

---

## 2g. What has been done — Milestone M6 · WebSockets (live feeds)

The first M6 feature module: authenticated real-time push, so prices update without polling. The fan-out architecture (one upstream fetch → many subscribers) is the reusable core; a true broker WS stream can slot in behind the same interface later.

### 2g.1 Backend WS layer (`app/websocket/`)
- **`manager.py`** — in-process `ConnectionManager`: tracks connections + per-connection channel subscriptions; `broadcast(channel, msg)` delivers to all subscribers and prunes dead sockets. `active_channels()` is what the publisher polls. *(Multi-worker fan-out = same interface + a Redis pub/sub bridge; documented.)*
- **`channels.py`** — channel grammar `kind:selector` (`quote:1`, `oi:1`); validation.
- **`router.py`** — `WSS /api/v1/ws?token=<jwt>`. JWT validated the same way as HTTP (browsers can't set WS headers, so the token is a query param). Protocol: `subscribe`/`unsubscribe`/`ping` in; `connected`/`subscribed`/`quote`/`pong`/`error` out. **On subscribe it pushes an immediate snapshot** so the client shows data at once.
- **`snapshots.py`** — fetches a channel's payload via the M2 `market_data` facade (so polling many times costs ≤1 upstream hit per TTL window). Shared by the route + publisher.
- **`publisher.py`** — background loop (started in lifespan) that polls only channels with subscribers and broadcasts. No subscribers → no work. Cadence `WS_PUBLISH_INTERVAL_SECONDS` (default 3s).

### 2g.2 Frontend WS client (`frontend/src/lib/`)
- **`liveFeed.ts`** — a single shared, auto-reconnecting `WebSocket` with **ref-counted channel subscriptions** and a listener set; re-subscribes its active channels on reconnect. Token from the auth store.
- **`useLiveQuotes.ts`** — `useLiveQuotes(ids)` / `useLiveQuote(id)` hooks returning the latest quote per instrument, live.
- **`DashboardPage`** overlays live prices on the NIFTY/SENSEX cards (they tick in real time via `AnimatedNumber`); `vite.config.ts` proxy gained `ws: true`.

### 2g.3 Verified
- In-process (Starlette TestClient): connect+auth, subscribe (invalid channels filtered), immediate snapshot, ping→pong, **bad/missing token → rejected** (close 1008).
- Publisher pushes **live ticks** on its interval (mock walk → prices vary).
- **Real socket** against a running uvicorn (`websockets` client): connect → subscribe → live ticks over a genuine WS. Frontend `tsc -b` + `npm run build` clean.

> **Scope honesty:** updates are driven by polling the (cached) market-data facade, not yet a broker WebSocket stream — so tick freshness follows the provider cache TTL for live vendors (mock ticks every cadence). Swapping in Fyers' WS later means feeding `manager.broadcast(...)` from the stream callback; route/manager/frontend unchanged. Fan-out is single-worker in-process (Redis pub/sub is the multi-worker step). `oi:{id}` channels are supported but only `quote` is wired into the UI so far.

---

## 3. Files touched / added

| Path | Change |
|---|---|
| `backend/alembic.ini` | **New content** — real config, blank URL (injected by env.py) |
| `backend/alembic/env.py` | **New content** — async migration environment |
| `backend/alembic/script.py.mako` | **New** — migration template |
| `backend/alembic/versions/20260705_0826-5a2843c19f71_baseline_current_schema.py` | **New** — authoritative baseline (tables + 26 checks + 3 views + 2 functions) |
| `backend/app/db/models.py` | `instrument_id` → `autoincrement=False` (fix latent SERIAL drift) |
| `backend/app/instruments/__init__.py`, `ref.py` | **New** — `InstrumentRef` + resolver + cache |
| `backend/app/tenancy/__init__.py`, `context.py` | **New** — `TenantContext` contextvar plumbing |
| `backend/app/core/deps.py` | **Added** instrument + tenant + optional-user dependencies (additive) |
| **M1 →** | |
| `backend/app/db/models.py` | `Instrument` extended with 11 rich columns (uid, strike_step, expiry_rule, vendor_symbols JSONB, …) |
| `backend/alembic/versions/…debc9e15fc9b_instrument_master_rich_columns.py` | **New** migration — add columns + backfill NIFTY/SENSEX |
| `backend/app/instruments/seed.py` | **New** — canonical `DEFAULT_INSTRUMENTS` seed data (ex-hardcoded dicts) |
| `backend/app/instruments/service.py` | **New** — `upsert_instruments` importer + list/search/get read helpers |
| `backend/app/instruments/ref.py` | `InstrumentRef` fully populated (uid, status, snapshot_enabled, float coercion, `vendor_symbol(kind)`) |
| `backend/app/api/v1/routers/instruments.py` | **New** — `GET /instruments`, `/search`, `/{id}` |
| `backend/app/domain/schemas.py` | **Added** `InstrumentOut`; annotated the legacy `InstrumentId` enum as back-compat-only |
| `backend/app/main.py` | Seed now upserts rich data via the importer; instruments router mounted |
| **M2 →** | |
| `backend/app/brokers/base.py` | **New** — `BrokerAdapter` ABC (read surface + trading stubs) |
| `backend/app/brokers/fyers/adapter.py` | **New** — `FyersAdapter` (delegates to `fyers_provider`, preserves rate-limit fix) |
| `backend/app/brokers/mock/adapter.py` | **New** — `MockAdapter` (delegates to `mock_provider`) |
| `backend/app/brokers/registry.py` | **New** — adapter resolution (`get_market_data_adapter`) |
| `backend/app/market_data/service.py` | **New** — async `MarketDataService` facade (threadpool over adapters) |
| `backend/app/brokers/connections.py` | **New** — Fernet encrypt/decrypt + async save/get/revoke + startup hydrate |
| `backend/app/db/models.py` | **Added** `BrokerConnection` model (encrypted token store) |
| `backend/alembic/versions/…a2aa386db8ed_broker_connections_table.py` | **New** migration |
| `backend/app/core/token_store.py` | **Added** `set_in_memory` (hydrate without `.env` write); noted DB is now primary |
| `backend/app/core/config.py` | **Added** `BROKER_TOKEN_ENC_KEY` (derives from `SECRET_KEY` if unset) |
| `backend/app/api/v1/routers/fyers_auth.py` | Callback/manual-set now persist encrypted token to DB |
| `backend/app/main.py` | Lifespan hydrates the Fyers token from the DB on boot |
| **M3 →** | |
| `backend/app/instruments/snapshot.py` | **New** — sync instrument snapshot cache (+ `lot_size`/`strike_step` helpers) |
| `backend/app/market_data/expiry.py` | **New** — generic per-instrument expiry engine |
| `backend/app/ingestion/providers/fyers_provider.py` | Deleted symbol/instrument dicts → snapshot helpers; generic futures; step-based ATM |
| `backend/app/ingestion/providers/mock_provider.py` | Symbol/step from snapshot (price bases stay dev fixtures) |
| `backend/app/engines/options_math.py` | Deleted `LOT_SIZE`; `atm_strike` takes `step` |
| `backend/app/services/options_service.py`, `options_lab_service.py` | `LOT_SIZE`/`_SYMBOLS` → snapshot helpers |
| `backend/app/api/v1/routers/*.py` (7 files) | Removed all `le=2` guards; `index` `_SYMBOLS` → snapshot |
| `backend/app/api/v1/routers/dashboard.py` | Generic `instruments` list + `nifty_*`/`sensex_*` back-compat shim |
| `backend/app/api/v1/routers/copilot.py`, `fyers_auth.py` | NIFTY/SENSEX ternaries → snapshot lookup |
| `backend/app/ingestion/scheduler.py` | `_INSTRUMENTS=(1,2)` → DB `snapshot_enabled_ids()` + per-cycle refresh |
| `backend/app/main.py` | Lifespan hydrates the instrument snapshot on boot |
| **M4 →** | |
| `frontend/src/api/endpoints.ts` | `InstrumentId` → `number`; `InstrumentMeta` + `getInstruments`/`searchInstruments`; `DashboardInstrumentEntry` |
| `frontend/src/lib/queryClient.ts` | **New** — shared React Query client |
| `frontend/src/lib/useInstruments.ts` | **New** — `useInstruments`/`useInstrumentSearch`/`useInstrumentMeta` hooks |
| `frontend/src/main.tsx` | Wrapped app in `QueryClientProvider` |
| `frontend/src/components/InstrumentSearch.tsx` | **New** — global instrument search combobox |
| `frontend/src/components/Navbar.tsx` | Mounted `InstrumentSearch` in the right cluster |
| `frontend/src/components/ui/InstrumentTabs.tsx` | Catalog-driven (was fixed NIFTY/SENSEX) |
| `frontend/src/lib/useInstrument.ts` | Accepts any positive integer id |
| `frontend/src/pages/DashboardPage.tsx` | Focused slice from generic `instruments` list + catalog |
| `frontend/package.json` | Added `@tanstack/react-query` |
| **M5 →** | |
| `backend/app/db/models.py` | **Added** 8 tenant models (Organization, Membership, Role, Permission, RolePermission, ApiKey, Plan, Subscription) |
| `backend/alembic/versions/…359a6ec8421d_multi_tenant_saas_tables.py` | **New** migration + seed (roles/perms/grants/plans) + RLS policies |
| `backend/app/tenancy/org_service.py` | **New** — org provisioning + active-org/role/permission resolution |
| `backend/app/tenancy/api_key_service.py` | **New** — hashed, org-scoped API keys |
| `backend/app/tenancy/context.py` | `TenantContext` gains `role` + `permissions` |
| `backend/app/core/security.py` | `create_access_token` gains optional `org`/`role` claims |
| `backend/app/services/auth_service.py` | Register provisions org; login/refresh mint claims + lazy backfill |
| `backend/app/core/deps.py` | `get_tenant_context` resolves org + sets RLS var; `require_permission`/`require_role` |
| `backend/app/api/v1/routers/tenancy.py` | **New** — `/me/tenancy`, `/orgs`, `/orgs/{id}/members`, `/api-keys` |
| `backend/app/main.py` | **Startup runs `alembic upgrade head`** (retired `create_all`); mounted tenancy router |
| **M6 · WebSockets →** | |
| `backend/app/websocket/{manager,channels,router,snapshots,publisher}.py` | **New** — WS layer (fan-out, `/ws` route, publisher) |
| `backend/app/core/config.py` | **Added** `WS_PUBLISH_INTERVAL_SECONDS` |
| `backend/app/main.py` | Mounted `/ws`; start/stop publisher in lifespan |
| `frontend/src/lib/liveFeed.ts`, `useLiveQuotes.ts` | **New** — reconnecting WS client + hooks |
| `frontend/src/pages/DashboardPage.tsx` | Live prices on the index cards |
| `frontend/vite.config.ts` | `/api` proxy `ws: true` |

**Known follow-ups deliberately deferred:**
- *Cosmetic constraint-name drift* — live DB uses bespoke `uq_*` names (from the hand-written SQL) while the ORM baseline uses SQLAlchemy defaults (`*_key`); **functionally identical** (same uniqueness enforced). Will be normalized with a metadata `naming_convention` + a rename migration in **M1**, when we're already altering the `instruments` table.
- `docs/postgres_db_creation.sql` still exists as the legacy bootstrap; deprecate once Alembic is trusted (M1).

---

## 4. The roadmap — milestones, and what each achieves

Every milestone is independently shippable and leaves the terminal working (strangler pattern).

- **M0 — Foundations** ✅ *(this note)* — Alembic + baseline; `InstrumentRef` & `TenantContext` plumbing. **Unblocks all schema and generalization work.**

- **M1 — Instrument Master** ✅ — Extended the `instruments` table with the rich columns via Alembic; built the importer + `GET /instruments` / `/search` / `/{id}`; moved the symbol/lot/step/expiry data into the master (source of truth) and populated `InstrumentRef`. App shows NIFTY/SENSEX from DB data. *(Provider dicts flip to reading the master in M2/M3; naming-convention cleanup reconsidered → parked, see §2b.4.)*

- **M2 — Broker Adapter + Market Data Service** ✅ — Built the `BrokerAdapter` ABC + Fyers/Mock adapters (wrapping the proven providers, rate-limit fix intact) + registry + the async `market_data/service.py` facade; added the encrypted `broker_connections` table + service and wired token persistence/hydration. The abstraction + durable token store are in place; **M3 flips the consumers onto the facade and deletes the provider dicts** (that's when the app fully "stops calling Fyers directly").

- **M3 — De-hardcode the API** ✅ — Deleted every hardcoded instrument constant on the request path (`_SPOT_SYMBOLS`/`_OPTION_SYMBOLS`/`_SYMBOLS`/`_ALL_INSTRUMENTS`/`LOT_SIZE`/`_STEP`/`_INSTRUMENTS`, all `le=2` guards, the NIFTY/SENSEX ternaries); introduced the sync instrument snapshot + generic expiry engine; made `/dashboard` generic with a `nifty_*`/`sensex_*` back-compat shim; scheduler iterates DB instruments. **← Backend now supports any instrument.** (*Follow-up: clean 404 for unknown ids via `get_instrument_ref` — deferred, frontend only sends valid ids.*)

- **M4 — Frontend generalization** ✅ — Widened `InstrumentId` to `number`; fetched the catalog from the API; added the **global instrument search** + catalog-driven tabs; introduced **React Query** (catalog/search cached); made the dashboard's focused slice consume the generic `instruments` list. UI otherwise unchanged. *(Most pages still use `useFetch` — incremental migration, non-blocking.)*

- **M5 — Multi-tenant SaaS** ✅ — Organizations, memberships, roles/permissions (seeded), API keys, plans/subscriptions tables + **Postgres RLS** (deploy-ready); org/role-aware JWT + `TenantContext`; `require_permission` authz; personal-org provisioning with lazy backfill for existing users. Also fixed the create_all/Alembic race (startup now migrates). *(Live Razorpay billing + OAuth/2FA deferred; RLS enforces under a non-superuser DB role.)*

- **M6+ — Modules** — **WebSockets ✅** (live feeds; in-process fan-out now, Redis pub/sub for multi-worker) → Alerts/Notifications (Celery) → Watchlists → Scanner → Strategy Builder (payoff/greeks/margin/POP) → Backtesting → Paper Trading → Journal → AI suite → Public API/SDK → more brokers & markets (MCX/CDS/stocks, then crypto/US/global).

---

## 5. Hard constraints preserved throughout (do **not** "fix" these)
- **Datetimes are naive UTC by design** — never switch columns to `TIMESTAMPTZ`.
- **IST = fixed `timezone(timedelta(hours=5, minutes=30))`** — never `ZoneInfo("Asia/Kolkata")` (no IANA tzdata on this Windows box; the silent UTC fallback previously killed morning ingestion).
- **`ck_ocr_iv`: never persist `iv = 0`** — use `NULL`.
- **Refresh tokens are single-use** — the frontend coalesces refreshes.
- **Backend runs on `uv`** (Python 3.11) — `cd backend; uv run app.py`; global Python 3.14 breaks installs.

---

## 6. How to verify M0 locally
```powershell
cd backend
uv run alembic current          # → 5a2843c19f71 (head)   [after M1: debc9e15fc9b (head)]
uv run alembic history          # baseline present
uv run python -c "from app.main import app; print(len(app.routes))"   # app boots
uv run app.py                   # terminal still serves NIFTY/SENSEX unchanged
```
A fresh database can now be built purely from migrations: create an empty DB, point `.env` at it, `uv run alembic upgrade head` → full schema with all constraints/views/functions.

---

## 7. How to review M1 (step by step)

Everything below is **read-only** except the optional "prove it's generic" step, which is clearly marked. Run from `backend/` with the uv env.

> **Shell note:** the short `uv run alembic …` commands work in any shell. The multi-line `uv run python - <<'PY' … PY` blocks are **bash heredocs** — run them in Git Bash / WSL. In Windows PowerShell instead paste the Python into a temp file and run `uv run python tmp.py`, or use `@'…'@ | uv run python -`.

### 7.1 Read the code (what changed, in review order)
1. `app/db/models.py` → `Instrument` — the 11 new columns + why (docstring). This is the schema.
2. `alembic/versions/…debc9e15fc9b_instrument_master_rich_columns.py` — the migration + the NIFTY/SENSEX **backfill** SQL. Confirm `upgrade()`/`downgrade()` are symmetric.
3. `app/instruments/seed.py` — the canonical `DEFAULT_INSTRUMENTS`. Cross-check the values against the old hardcoded dicts (see the mapping comment at the top of the file).
4. `app/instruments/ref.py` — `InstrumentRef` (fields, `vendor_symbol(vendor, kind)`, `Decimal`→`float` coercion, cache roundtrip).
5. `app/instruments/service.py` — `upsert_instruments` (importer) + `list/search/get`.
6. `app/api/v1/routers/instruments.py` — the 3 endpoints; `domain/schemas.py` → `InstrumentOut`.

### 7.2 Confirm the migration state is clean
```powershell
uv run alembic current      # → debc9e15fc9b (head)
uv run alembic history      # two revisions: baseline → rich columns
```

### 7.3 Confirm the live data was backfilled (read-only)
```powershell
uv run python - <<'PY'
import asyncio
from app.db.session import AsyncSessionLocal
from app.instruments import resolve_instrument
async def go():
    async with AsyncSessionLocal() as db:
        for i in (1, 2):
            r = await resolve_instrument(db, i, use_cache=False)
            print(r.instrument_id, r.label, r.exchange, "step=", r.strike_step,
                  "lot=", r.lot_size, "expiry=", r.expiry_rule,
                  "fyers_spot=", r.vendor_symbol("fyers"))
asyncio.run(go())
PY
```
Expected: `1 NIFTY 50 NSE step= 50.0 lot= 65 expiry= MONTHLY_LAST_THU fyers_spot= NSE:NIFTY50-INDEX` and the SENSEX equivalent (step 100, lot 20, BSE).
> A Redis timeout line may print — that is the cache facade falling back to in-process (Redis not running). It is expected and harmless.

### 7.4 Exercise the new endpoints
Start the app (`uv run app.py`) and open **http://127.0.0.1:8000/api/docs** → the new **instruments** tag. Or hit them from the browser once logged in (the frontend proxies `/api`). Endpoints require a bearer token:
- `GET /api/v1/instruments` → both instruments with rich fields (`uid`, `strike_step`, `tick_size`, `label`, …).
- `GET /api/v1/instruments/search?q=sens` → `[SENSEX]`; `?q=nif` → `[NIFTY50]`.
- `GET /api/v1/instruments/2` → SENSEX; `GET /api/v1/instruments/99` → **404**.
- Any of them without a token → **401**.

### 7.5 (Optional) Prove it's genuinely generic — add a 3rd instrument
This is the real acceptance test for M1. It **writes one row**; delete it afterwards to leave the DB as-is.
```powershell
uv run python - <<'PY'
import asyncio
from app.db.session import AsyncSessionLocal
from app.instruments.service import upsert_instruments, search_instruments
async def go():
    async with AsyncSessionLocal() as db:
        await upsert_instruments(db, [{
            "instrument_id": 3, "symbol": "BANKNIFTY", "display_name": "NIFTY BANK",
            "exchange": "NSE", "segment": "INDEX", "instrument_type": "INDEX",
            "lot_size": 15, "tick_size": 0.05, "strike_step": 100,
            "expiry_rule": "MONTHLY_LAST_THU",
            "vendor_symbols": {"fyers": {"spot": "NSE:NIFTYBANK-INDEX",
                                          "option": "NSE:NIFTYBANK-INDEX",
                                          "futures_template": "NSE:BANKNIFTY{yy}{mon}FUT"}},
            "snapshot_enabled": True, "status": "ACTIVE", "is_active": True,
        }])
        await db.commit()
        hits = await search_instruments(db, "bank")
        print("search 'bank' ->", [(h.instrument_id, h.symbol, h.strike_step) for h in hits])
asyncio.run(go())
PY
```
Expected: `search 'bank' -> [(3, 'BANKNIFTY', 100.0)]` — a brand-new instrument, selectable via the API, **with zero code change**. That is the whole point of M1.

Cleanup (removes the test row):
```powershell
uv run python - <<'PY'
import asyncio, asyncpg
from app.core.config import settings
async def go():
    c = await asyncpg.connect(host=settings.DB_HOST, port=settings.DB_PORT,
        user=settings.DB_USER, password=settings.DB_PASSWORD, database=settings.DB_NAME)
    await c.execute("DELETE FROM instruments WHERE instrument_id = 3")
    await c.close(); print("removed test instrument 3")
asyncio.run(go())
PY
```

### 7.6 What M1 does NOT change (so you know what to expect)
- The existing NIFTY/SENSEX pages, charts, and numbers are **unchanged** — the providers still use their in-module dicts on the hot path; M1 only added the DB master + API alongside them.
- The provider dicts (`fyers_provider._SPOT_SYMBOLS`, `options_math.LOT_SIZE`, …) are **still present** — they are removed in **M3** when routers/services are rewired onto the Market Data Service. So don't expect them to be gone yet.
- Frontend is untouched in M1 (it still shows a fixed 2-tab picker) — it starts consuming `GET /instruments` in **M4**.

### 7.7 Rollback (if you want to undo M1 entirely)
```powershell
uv run alembic downgrade 5a2843c19f71   # drops the 11 columns; back to the M0 baseline
```
The app still runs after this (the rich columns are read via `getattr`, so their absence degrades to `None`), but re-run `uv run alembic upgrade head` to restore M1.

---

## 8. How to review M2 (step by step)

Read-only except the optional token round-trip (which writes then deletes one row). Run from `backend/`. (See the §7 shell note about bash heredocs on PowerShell.)

### 8.1 Read the code (review order)
1. `app/brokers/base.py` — the `BrokerAdapter` contract (methods take `InstrumentRef`, return the existing dict shapes; trading stubs).
2. `app/brokers/fyers/adapter.py` + `mock/adapter.py` — thin delegations to the existing providers (note: **rate-limit logic untouched**).
3. `app/brokers/registry.py` — how the adapter is chosen (and the forward hooks).
4. `app/market_data/service.py` — the async facade (threadpool over sync adapters; `by_ref` vs `by_id`).
5. `app/brokers/connections.py` — Fernet encryption + save/get/revoke + startup hydrate.
6. `app/db/models.py` → `BrokerConnection`; migration `…a2aa386db8ed`; the `fyers_auth.py` persistence wiring; `main.py` lifespan hydration.

### 8.2 Confirm migration state
```powershell
uv run alembic current      # → a2aa386db8ed (head)
uv run alembic history      # baseline → rich columns → broker_connections
```

### 8.3 Exercise the facade (data flows through the abstraction)
```powershell
uv run python - <<'PY'
import asyncio
from app.db.session import AsyncSessionLocal
from app.instruments import resolve_instrument
from app.market_data import market_data
from app.brokers.registry import get_adapter
async def go():
    print("adapters:", get_adapter("mock").name, get_adapter("fyers").name)
    async with AsyncSessionLocal() as db:
        ref = await resolve_instrument(db, 1, use_cache=False)
    spot = await market_data.get_spot(ref)
    oi   = await market_data.get_open_interest(ref)
    print("vendor:", market_data.adapter_name(ref), "| last_price:", spot["last_price"])
    print("derived OI  call:", oi["total_call_oi"], "put:", oi["total_put_oi"])
asyncio.run(go())
PY
```
Expected: adapters `mock fyers`; a `last_price`; non-zero call/put OI. (The active vendor reflects `MARKET_DATA_VENDOR` in `.env`.)

### 8.4 Prove tokens are encrypted at rest (writes + deletes one row)
```powershell
uv run python - <<'PY'
import asyncio, asyncpg
from app.db.session import AsyncSessionLocal
from app.brokers import connections as conn
from app.core.config import settings
async def go():
    async with AsyncSessionLocal() as db:
        await conn.save_broker_token(db, "fyers", "demo-TOKEN-123", user_id=None); await db.commit()
    async with AsyncSessionLocal() as db:
        print("decrypted get:", await conn.get_broker_token(db, "fyers", user_id=None))
    c = await asyncpg.connect(host=settings.DB_HOST, port=settings.DB_PORT, user=settings.DB_USER,
                              password=settings.DB_PASSWORD, database=settings.DB_NAME)
    raw = await c.fetchval("select access_token_enc from broker_connections where broker='fyers' and user_id is null")
    print("stored is ciphertext (not plaintext):", raw is not None and "demo-TOKEN-123" not in raw)
    await c.execute("delete from broker_connections where broker='fyers'"); await c.close()
    print("cleaned up")
asyncio.run(go())
PY
```
Expected: `decrypted get: demo-TOKEN-123`, `stored is ciphertext … : True`, `cleaned up`.

### 8.5 What M2 does NOT change
- The live request path (dashboard/options/etc.) **still calls `ingestion.providers.*` directly** — the facade is wired but not yet consumed. That switch is **M3**.
- The provider symbol/lot/step dicts are **still present** (deleted in M3).
- Only one real user exists; `broker_connections.user_id` is `NULL` (global) until **M5** adds per-user/tenant auth.
- The Fyers `.env` token still works as a fallback — but the durable source is now the encrypted DB row.

### 8.6 Rollback (undo M2's schema)
```powershell
uv run alembic downgrade debc9e15fc9b   # drops broker_connections; back to end-of-M1
```
The broker/market_data code is additive and harmless if unused; re-run `uv run alembic upgrade head` to restore.

---

## 9. How to review M3 (step by step)

M3 has **no schema change** — it's pure de-hardcoding of the request path, so review is mostly reading + running. (See the §7 shell note about bash heredocs on PowerShell.)

### 9.1 Read the code (review order)
1. `app/instruments/snapshot.py` — the sync cache the providers read (why it exists; `lot_size`/`strike_step` helpers).
2. `app/market_data/expiry.py` — the generic expiry engine (rule → month code → symbol).
3. `app/ingestion/providers/fyers_provider.py` — the deleted dicts are gone; note the batched `_refresh_all_spots` still builds one quotes() call, now from the snapshot.
4. `app/ingestion/providers/mock_provider.py`, `app/engines/options_math.py` (no `LOT_SIZE`), the two `services/*` files.
5. `app/api/v1/routers/dashboard.py` — generic `instruments` list + back-compat shim; `scheduler.py` (`snapshot_enabled_ids`); `copilot.py`/`fyers_auth.py`.

### 9.2 Prove no hardcoding remains (grep)
```powershell
uv run python -c "print('run the grep below')"   # or just run rg/grep:
# Expect only comments/docstrings/seed — NO live dicts/tuples/guards:
```
```bash
grep -rn "le=2\|_INSTRUMENTS\b\|_SPOT_SYMBOLS\|_OPTION_SYMBOLS\|LOT_SIZE = \|instrument_id == 1" backend/app --include=*.py
```

### 9.3 Run it — the headline test: add a 3rd instrument, watch it flow end-to-end
This is the whole point of M3: an instrument added as **data** works through spot/chain/dashboard with **zero code change**. Writes rows; cleanup at the end.
```powershell
uv run python - <<'PY'
import asyncio
from app.db.session import AsyncSessionLocal
from app.instruments.service import upsert_instruments
from app.instruments import snapshot
from app.ingestion.providers import mock_provider as mp   # deterministic
async def go():
    async with AsyncSessionLocal() as db:
        await upsert_instruments(db, [{
            "instrument_id": 3, "symbol": "BANKNIFTY", "display_name": "NIFTY BANK",
            "exchange": "NSE", "segment": "INDEX", "instrument_type": "INDEX",
            "lot_size": 15, "tick_size": 0.05, "strike_step": 100,
            "expiry_rule": "MONTHLY_LAST_THU",
            "vendor_symbols": {"fyers": {"spot": "NSE:NIFTYBANK-INDEX",
                                          "option": "NSE:NIFTYBANK-INDEX",
                                          "futures_template": "NSE:BANKNIFTY{yy}{mon}FUT"}},
            "snapshot_enabled": True, "status": "ACTIVE", "is_active": True,
        }])
        await db.commit()
        await snapshot.refresh(db)
    # providers now serve id=3 with ITS lot/step/symbol — no code touched
    print("lot_size(3)  =", snapshot.lot_size(3), "(expect 15)")
    print("strike_step  =", snapshot.strike_step(3), "(expect 100)")
    ch = mp.get_option_chain(3)
    print("chain symbol =", mp.get_spot(3)["symbol"], "| atm=", ch["atm_strike"],
          "| strike gap=", ch["rows"][2]["strike"] - ch["rows"][0]["strike"], "(expect 100)")
    from app.market_data.expiry import build_fyers_futures_symbol
    print("futures sym  =", build_fyers_futures_symbol(snapshot.get(3)), "(NSE:BANKNIFTY..FUT)")
asyncio.run(go())
PY
```
Then start the app and hit `GET /api/v1/dashboard` — the `instruments` list now has **three** entries (NIFTY 50, SENSEX, NIFTY BANK), and `GET /api/v1/index/3/snapshot` returns BANKNIFTY. No source file changed.

Cleanup:
```powershell
uv run python - <<'PY'
import asyncio, asyncpg
from app.core.config import settings
async def go():
    c = await asyncpg.connect(host=settings.DB_HOST, port=settings.DB_PORT, user=settings.DB_USER,
                              password=settings.DB_PASSWORD, database=settings.DB_NAME)
    await c.execute("DELETE FROM instruments WHERE instrument_id = 3"); await c.close()
    print("removed test instrument 3")
asyncio.run(go())
PY
```

### 9.4 Confirm nothing regressed for the current 2 instruments
Boot the app, log in via the frontend: NIFTY/SENSEX dashboards, option chain, OI tools, Future Lab render exactly as before (the `nifty_*`/`sensex_*` back-compat keys are unchanged). Futures symbols still `NSE:NIFTY..FUT` / `BSE:SENSEX..FUT`.

### 9.5 What M3 does NOT change
- **Frontend is untouched** — still a fixed 2-tab picker; it starts consuming `GET /instruments` and the generic `dashboard.instruments` list in **M4**. The back-compat shim is what keeps it working now.
- Unknown ids (e.g. `/index/9/snapshot`) return **200 with mock/empty data**, not a 404 — the `le=2` guard is gone but per-route DB validation is a deferred nicety.
- No new tables/migrations (M3 is code-only); `alembic current` stays `a2aa386db8ed`.

### 9.6 Rollback
M3 is code-only — `git checkout` the M3 files (or the commit) to revert. No DB downgrade needed.

---

## 10. How to review M4 (step by step)

M4 is **frontend-only** (plus one npm dependency). No backend or DB change.

### 10.1 Read the code (review order)
1. `frontend/src/api/endpoints.ts` — `InstrumentId = number`, `InstrumentMeta`, `getInstruments`/`searchInstruments`, `DashboardInstrumentEntry`.
2. `frontend/src/lib/queryClient.ts` + `main.tsx` — React Query wiring.
3. `frontend/src/lib/useInstruments.ts` — catalog + search hooks.
4. `frontend/src/components/InstrumentSearch.tsx` — the palette; `Navbar.tsx` mount point.
5. `frontend/src/components/ui/InstrumentTabs.tsx`, `lib/useInstrument.ts` — catalog-driven tabs + generic id.
6. `frontend/src/pages/DashboardPage.tsx` — focused slice from `data.instruments`.

### 10.2 Static checks (fast, deterministic)
```powershell
cd frontend
npx tsc -b --force     # exit 0, no errors
npm run build          # succeeds (2529 modules)
npm run dev            # boots; open the printed URL
```

### 10.3 The headline test — pick any instrument in the browser
1. Run backend (`cd backend; uv run app.py`) + frontend (`cd frontend; npm run dev`); log in (test login: `claude-verify@strikfin.dev`).
2. **Instrument tabs** (top-right of Dashboard/Options/etc.) now come from the API catalog, not a hardcoded pair.
3. **Global search** (navbar, magnifier): type `sens` → SENSEX; type `nif` → NIFTY 50; pick one → the page's `?inst=` updates and the focused panels (AI Bias, Options Metrics, chain) follow.
4. **Add a 3rd instrument** (run the §9.3 backend snippet to insert BANKNIFTY, id 3). Refresh the app → BANKNIFTY appears in **search** and (if within the first `max`) in the **tabs**; select it → the dashboard's focused slice + option chain render for it. **No frontend code changed.** (Then run the §9.3 cleanup to remove it.)

### 10.4 Confirm no visual regression
For the default two instruments the Dashboard looks identical: the NIFTY 50 / SENSEX reference cards, AI Bias, VIX, option chain, and AI summary all render as before (the generic path falls back to the same data).

### 10.5 What M4 does NOT change
- **Most pages still use `useFetch`** — only the instrument catalog + search use React Query. Porting the rest is incremental and non-blocking.
- `AdvancedDashboardPage` keeps its side-by-side NIFTY/SENSEX **futures** comparison (a designed two-index reference view).
- No multi-tenant/auth changes — that's **M5**.

### 10.6 Rollback
Frontend-only: `git checkout` the M4 files, then `npm install` (to drop `@tanstack/react-query` from `node_modules` if desired). No DB/back-end impact.

---

## 11. How to review M5 (step by step)

M5 adds a schema migration + auth/tenancy code. It's already applied to the live DB.

### 11.1 Read the code (review order)
1. `backend/app/db/models.py` (tenant section) + migration `…359a6ec8421d` — tables, seed (roles/perms/grants/plans), RLS policies.
2. `backend/app/tenancy/org_service.py` — provisioning + active-org/role/permission resolution.
3. `backend/app/core/security.py` (org/role claims), `backend/app/services/auth_service.py` (register/login/refresh wiring + lazy backfill).
4. `backend/app/core/deps.py` — `get_tenant_context` (resolve + RLS var) and `require_permission`/`require_role`.
5. `backend/app/tenancy/api_key_service.py` + `routers/tenancy.py` — the SaaS endpoints.
6. `backend/app/main.py` — the `create_all` → `alembic upgrade head` startup switch.

### 11.2 Confirm migration + seed + RLS on the live DB
```powershell
cd backend
uv run alembic current      # → 359a6ec8421d (head)
uv run python - <<'PY'
import asyncio, asyncpg
from app.core.config import settings
async def go():
    c = await asyncpg.connect(host=settings.DB_HOST, port=settings.DB_PORT, user=settings.DB_USER,
                              password=settings.DB_PASSWORD, database=settings.DB_NAME)
    print("roles/perms/grants/plans:",
          await c.fetchval("select count(*) from roles"),
          await c.fetchval("select count(*) from permissions"),
          await c.fetchval("select count(*) from role_permissions"),
          await c.fetchval("select count(*) from plans"))
    rls = await c.fetch("select tablename from pg_tables where schemaname='public' and rowsecurity=true order by tablename")
    print("RLS tables:", [r["tablename"] for r in rls])
    await c.close()
asyncio.run(go())
PY
```
Expected: `4 13 37 4` and RLS on `api_keys, memberships, organizations, subscriptions`.

### 11.3 The headline test — register → org → role → API key
```powershell
uv run python - <<'PY'
import asyncio, secrets, base64, json
from httpx import ASGITransport, AsyncClient
from app.main import app
async def go():
    email = f"review_{secrets.token_hex(4)}@strikfin.dev"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/v1/auth/register", json={"email":email,"password":"password123","display_name":"Reviewer"})
        tok = (await c.post("/api/v1/auth/login", json={"email":email,"password":"password123"})).json()["access_token"]
        claims = json.loads(base64.urlsafe_b64decode(tok.split(".")[1]+"=="))
        print("token has org+role:", "org" in claims, claims.get("role"))
        H = {"Authorization": f"Bearer {tok}"}
        t = (await c.get("/api/v1/me/tenancy", headers=H)).json()
        print("role/perms/orgs:", t["role"], len(t["permissions"]), len(t["orgs"]))
        print("create org:", (await c.post("/api/v1/orgs", json={"name":"Acme"}, headers=H)).status_code)
        k = (await c.post("/api/v1/api-keys", json={"name":"CI"}, headers=H)).json()
        print("api key issued:", k["api_key"][:12], "…")
asyncio.run(go())
PY
```
Expected: token has org+role `owner`; role owner / 13 perms / 1 org; create org `201`; an `sk_live_…` key.

### 11.4 Confirm existing login still works (no regression)
Log in through the frontend with your existing account. First login **lazily provisions a personal org** (you'll see one owner org in `/me/tenancy`); everything else behaves as before. The dashboards/options/etc. are unauthenticated-by-tenant (market data is global), so they're unaffected.

### 11.5 What M5 does NOT change / caveats
- **RLS does not enforce yet** because the app connects as a Postgres **superuser** (which bypasses RLS). App-layer scoping is the real isolation today; deploy under a non-superuser role to activate RLS. *(To test RLS now: create a non-superuser role, `GRANT` table privileges, point `DB_USER` at it, and repeat — cross-tenant reads then return nothing without `app.tenant_id` set.)*
- **Billing is schema-only** — `plans`/`subscriptions` exist and a `require_permission("org.billing")` gate is available, but there's **no live Razorpay** call yet.
- No OAuth/Google login or 2FA (planned later).
- The frontend has no org-switcher UI yet — the API is ready (`/me/tenancy`, `/orgs`); wiring it is a small M6 frontend task.

### 11.6 Rollback
```powershell
uv run alembic downgrade a2aa386db8ed   # drops the 8 tenant tables + RLS; back to end-of-M2
```
Then `git checkout` the M5 code files. (Auth reverts to single-user; existing users/tokens keep working since the claims are optional.)

---

## 12. How to review M6 · WebSockets (step by step)

No schema change — new `app/websocket/` package + a frontend client.

### 12.1 Read the code (review order)
1. `backend/app/websocket/manager.py` (fan-out) + `channels.py` (grammar).
2. `router.py` (auth + protocol + immediate snapshot) + `snapshots.py` (payload via `market_data`).
3. `publisher.py` (subscriber-gated poll loop) + `main.py` lifespan start/stop + `/ws` mount.
4. `frontend/src/lib/liveFeed.ts` (reconnecting, ref-counted) + `useLiveQuotes.ts` + `DashboardPage` overlay + `vite.config.ts` (`ws: true`).

### 12.2 Backend WS test (in-process, deterministic — mock vendor)
```powershell
cd backend
$env:MARKET_DATA_VENDOR="mock"; $env:WS_PUBLISH_INTERVAL_SECONDS="1"
uv run python - <<'PY'
from starlette.testclient import TestClient
from app.main import app
from app.core.security import create_access_token
tok = create_access_token(1)
with TestClient(app) as client:
    with client.websocket_connect(f"/api/v1/ws?token={tok}") as ws:
        print(ws.receive_json())                        # connected
        ws.send_json({"action":"subscribe","channels":["quote:1"]})
        print(ws.receive_json())                        # subscribed
        print("snapshot:", ws.receive_json()["data"]["last_price"])
        ticks=[ws.receive_json()["data"]["last_price"] for _ in range(3)]
        print("live ticks:", ticks, "vary:", len(set(ticks))>1)
    try:
        with client.websocket_connect("/api/v1/ws?token=bad") as ws: ws.receive_json()
        print("BAD: accepted bad token")
    except Exception as e:
        print("bad token rejected:", type(e).__name__)
PY
```
Expected: `connected` → `subscribed` → a snapshot price → 3 live ticks that vary → bad token rejected.

### 12.3 Browser test (the real thing)
Run backend + frontend (`npm run dev`), log in, open the **Dashboard**: the NIFTY 50 / SENSEX card prices **tick in real time** (every `WS_PUBLISH_INTERVAL_SECONDS`) without a network request per tick — watch the Network tab: one `ws` connection, no repeated `/dashboard` polls driving the price. In DevTools → Network → WS you can see the `subscribe` frame and streaming `quote` messages.

### 12.4 What M6-WS does NOT do yet
- Updates are **polled from the cached market-data facade**, not a live broker WS stream — so for a live vendor, freshness follows the provider cache TTL (mock ticks every cadence). The broker-stream swap is a drop-in behind `manager.broadcast`.
- **Single-worker** in-process fan-out (fine for one API process). Multi-worker needs the Redis pub/sub bridge.
- Only `quote` channels are wired into the UI; `oi:{id}` is supported server-side but not yet consumed.

### 12.5 Rollback
Code-only: `git checkout` the M6 files (backend `app/websocket/`, the `main.py`/`config.py` hunks, the frontend `lib/liveFeed.ts`/`useLiveQuotes.ts`, `DashboardPage`, `vite.config.ts`). No DB impact.
