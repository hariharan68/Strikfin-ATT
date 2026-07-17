# Roadmap

## Known TODOs from Codebase

Items explicitly noted in source code comments or docstrings as production gaps or future work:

### Data & Providers

- **FinBERT sentiment inference** — `routers/sentiment.py`: "In production this is replaced by FinBERT inference." The mock MD5 scorer is a deterministic placeholder.
- **LLM sentiment escalation** — `routers/sentiment.py`: "Escalate ambiguous / high-impact items to LLM." Step 4 of the production sentiment pipeline is not yet implemented.
- **VIX percentile from real 52-week history** — `engines/options_math.iv_percentile` / the signal pipeline use a linear approximation in place of a true rolling-window percentile.
- **Real FII rolling 5d/20d figures** — `routers/institutional.py`: "Mock rolling figures (real: queried from DB)." Currently approximated with random multipliers on the daily value.
- **Final NSDL/CDSL institutional data** — `routers/institutional.py`: All institutional data is currently marked `is_provisional=True`. NSDL/CDSL integration for final EOD figures is not implemented.
- **IV percentile from rolling 1-year IV history** — `engines/options_math.py`: "Production: percentile of current IV vs trailing 1-year IV series." Currently a linear proxy within [10, 25] band.
- **News API / RSS feed integration** — `providers/__init__.py`: News headlines and FII/DII data are mock-only; Fyers does not provide these. A real news ingestion pipeline is needed.
- **Extend caching to index snapshots** — the resilient cache facade (`core/cache.py`) is live and backs the options + options-lab read endpoints; `/index/*` endpoints are not cached yet and could be added the same router-level way.
- **Return_5d and range_compression from price history** — `services/signal_service.py`: "return_5d / range_compression need history not present in a single snapshot, so they default to honest neutral values." A rolling price history store is needed.
- **`ck_ocr_iv` constraint vs. IV=0 rows (RESOLVED)** — `option_chain_rows.ck_ocr_iv` allows `iv IS NULL OR iv > 0`. The Fyers provider now returns `None` for unrecoverable IV (recovered via Black-76 put-call parity), and the ingestion path never persists `iv = 0` — it stores `NULL`, so snapshots no longer fail with `CheckViolationError`.

### Testing

- **Engine unit test implementations** — engine test files (`test_options_math.py`, `test_synthesizer.py`, `test_regime.py`) are still empty stubs. `test_regime.py` is orphaned (the regime engine was removed) and should be deleted or repurposed to cover `short_covering` / `outcome`. (The GEX math **is** covered: 22 frontend vitest tests + a backend service test — see [TESTING.md](TESTING.md).)
- **Integration test suite** — No integration tests cover the full HTTP request → DB round trip.

### Infrastructure

- **Alembic (DONE)** — `alembic/env.py` is wired to the app models/URL and `alembic/versions/` holds a real history (baseline → instrument columns → `broker_connections` → multi-tenant tables → user-profile/preferences). `uv run alembic upgrade head` builds the schema from scratch. `docs/postgres_db_creation.sql` is a reference recreate kept in sync; Alembic is the source of truth.

---

## Planned Features

<!-- TODO: confirm — add planned features here as they are agreed upon -->

### Recently Shipped

- [x] Resilient cache facade (in-process + optional Redis, fail-fast + circuit breaker) — `core/cache.py`
- [x] Instrument-aware dashboards (NIFTY ⇄ SENSEX) via the dedicated `/options/{id}/*` endpoints
- [x] Dashboard / tool auto-refresh polling (15–30 s `useFetch` intervals)
- [x] Single-use refresh-token coalescing (no reload-logout)
- [x] Removal of the standalone regime engine/service/router (bias folded into the synthesizer)
- [x] **Options Lab migrated to Apache ECharts** (Multi OI & Volume, MultiStrike OI, Open Interest grouped bars) — axis tooltip, crosshair, legend toggles, zoom; never-remounted instance
- [x] **Price overlays plot current-month FUTURES** (`option_chain_snapshots.future_price`), not index spot
- [x] **IV via Black-76 put-call parity** — fixed CE-row IV showing 0.0%; unrecoverable IV → NULL / "—"
- [x] **Gamma Exposure (GEX) tool** — client-side math (`lib/gex.ts`), `GET /options-lab/gex-series/{id}`, walls / Net-GEX-Cross / zero-gamma flip, per-1%-move scaling matching StockMojo
- [x] **Settings persistence** — `user_preferences` + profile columns, `PATCH /auth/me`, `GET/PUT /me/preferences`, `GET /me/plan`; `usePreferences` store (chart tooltip + call/put scheme consumed)
- [x] **Four-theme system** (classic / warm / dark / terminal) via CSS-variable slate remap
- [x] **Multi-tenant plane** (orgs / roles / permissions / memberships / api_keys / plans / subscriptions) + `broker_connections` + DB-driven `instruments` master
- [x] **Alembic migrations live** (`env.py` wired, real version history) — `ck_ocr_iv` IV=0 bug resolved (persist NULL)
- [x] **Fyers `quotes()` throttle hardening** — one batched refresh + chain-derive fallback (`_spot_and_fut_from_chain`)

### Near-Term

- [ ] Unit tests for all engine functions (options_math, synthesizer, short_covering, outcome)
- [ ] VIX 52-week percentile from `index_live_data` rolling window
- [ ] Real 5d/20d FII rolling figures from `institutional_activity` table queries
- [ ] FinBERT inference integration for news sentiment scoring
- [ ] `news_feed` ingestion pipeline (NewsAPI or RSS)

### Medium-Term

- [ ] Extend the cache facade to `index_live_data` / `/index/*` endpoints
- [ ] Real NSDL/CDSL final institutional data integration (post 19:00 IST)
- [ ] Rolling IV history stored in DB for accurate IV percentile
- [ ] Historical price series for `return_5d`, `trend_strength`, and `range_compression` inputs
- [ ] Alert/notification system for AI-bias / signal changes

### Long-Term

- [ ] Full multi-tenant activation (RLS enforcement, per-org data isolation, billing) — the tenancy tables/plane exist; wire enforcement end-to-end
- [ ] Production deployment configuration (Docker, reverse proxy, HTTPS)
- [ ] SENSEX option chain support through Fyers (currently mock data only for SENSEX)
- [ ] Backtesting harness for the synthesizer bias signal (using `signal_outcomes`)

---

## Known Limitations

| Limitation | Root Cause | Workaround |
|---|---|---|
| Mock data only for news and institutional flows even when `MARKET_DATA_VENDOR=fyers` | Fyers API does not provide news or EOD FII/DII data | Manual data entry or third-party news API integration |
| Fyers tokens expire daily | Fyers OAuth design | Run `/auth/fyers/login` flow or paste token via `/auth/fyers/token` each morning |
| Synthesizer `return_5d` / `range_compression`-style inputs use placeholder values | No rolling price history table | Add an `index_live_data` window query in `SignalService` |
| No real ATR — `atr_20` estimated as `spot × 0.015` | No OHLC history | Add ATR computation from `index_live_data` |
| Smart-money signals not persisted to `smart_money_signals` table | Router computes and returns without DB write | Add DB persistence in a SmartMoneyService |
| `rolling_5d_fii_net` and `rolling_20d_fii_net` are random approximations | Mock provider, no DB history | Query `institutional_activity` for rolling sums |
| No production deployment docs | Not yet needed | Add Docker and Nginx config when deploying |

---

## Deployment Plans

<!-- TODO: confirm — document the intended production deployment target here -->

No production deployment configuration exists at this time. The application is currently designed for local single-machine use.

Likely future stack:
- Backend: Uvicorn behind Nginx or Azure App Service
- Database: Managed PostgreSQL (Azure Database for PostgreSQL / Amazon RDS) or self-hosted PostgreSQL
- Frontend: Static build served via Nginx or Azure Static Web Apps
- Environment: Docker Compose for local parity; Azure Container Apps or similar for production
