# Roadmap

## Known TODOs from Codebase

Items explicitly noted in source code comments or docstrings as production gaps or future work:

### Data & Providers

- **FinBERT sentiment inference** — `routers/sentiment.py`: "In production this is replaced by FinBERT inference." The mock MD5 scorer is a deterministic placeholder.
- **LLM sentiment escalation** — `routers/sentiment.py`: "Escalate ambiguous / high-impact items to LLM." Step 4 of the production sentiment pipeline is not yet implemented.
- **VIX percentile from real 52-week history** — `services/regime_service.py`: "real: compare against 52-week range." Currently uses a linear approximation `(vix − 10) / 20`.
- **Real FII rolling 5d/20d figures** — `routers/institutional.py`: "Mock rolling figures (real: queried from DB)." Currently approximated with random multipliers on the daily value.
- **Final NSDL/CDSL institutional data** — `routers/institutional.py`: All institutional data is currently marked `is_provisional=True`. NSDL/CDSL integration for final EOD figures is not implemented.
- **IV percentile from rolling 1-year IV history** — `engines/options_math.py`: "Production: percentile of current IV vs trailing 1-year IV series." Currently a linear proxy within [10, 25] band.
- **News API / RSS feed integration** — `providers/__init__.py`: News headlines and FII/DII data are mock-only; Fyers does not provide these. A real news ingestion pipeline is needed.
- **Redis hot cache for index snapshots** — `routers/index.py`: "In production this reads from Redis hot cache first." No Redis layer exists yet.
- **Return_5d and range_compression from price history** — `services/signal_service.py`: "return_5d / range_compression need history not present in a single snapshot, so they default to honest neutral values." A rolling price history store is needed.

### Testing

- **Unit test implementations** — Three test files exist (`test_options_math.py`, `test_regime.py`, `test_synthesizer.py`) but all are empty stubs. See [TESTING.md](TESTING.md) for full gap list.
- **Integration test suite** — No integration tests cover the full HTTP request → DB round trip.

### Infrastructure

- **Alembic migration files** — `alembic/versions/` is empty. No migration history has been generated. The first `alembic revision --autogenerate` command must be run before the DB can be created from scratch via Alembic.
- **Alembic env.py** — `alembic/env.py` is empty. It needs to be populated to point at the app models and database URL before migrations will work.

---

## Planned Features

<!-- TODO: confirm — add planned features here as they are agreed upon -->

### Near-Term

- [ ] Alembic `env.py` setup and initial migration generation
- [ ] Unit tests for all engine functions (options_math, regime, synthesizer, short_covering)
- [ ] VIX 52-week percentile from `index_live_data` rolling window
- [ ] Real 5d/20d FII rolling figures from `institutional_activity` table queries
- [ ] FinBERT inference integration for news sentiment scoring
- [ ] `news_feed` ingestion pipeline (NewsAPI or RSS)

### Medium-Term

- [ ] Redis hot-cache layer for `index_live_data` and option chain snapshots
- [ ] Real NSDL/CDSL final institutional data integration (post 19:00 IST)
- [ ] Rolling IV history stored in DB for accurate IV percentile
- [ ] Historical price series for `return_5d`, `trend_strength`, and `range_compression` inputs
- [ ] Dashboard auto-refresh polling (currently requires manual page reload)
- [ ] Alert/notification system for regime changes

### Long-Term

- [ ] Multi-user support (currently single-user by design)
- [ ] Production deployment configuration (Docker, reverse proxy, HTTPS)
- [ ] SENSEX option chain support through Fyers (currently mock data only for SENSEX)
- [ ] Backtesting harness for regime classifier and synthesizer

---

## Known Limitations

| Limitation | Root Cause | Workaround |
|---|---|---|
| Mock data only for news and institutional flows even when `MARKET_DATA_VENDOR=fyers` | Fyers API does not provide news or EOD FII/DII data | Manual data entry or third-party news API integration |
| Fyers tokens expire daily | Fyers OAuth design | Run `/auth/fyers/login` flow or paste token via `/auth/fyers/token` each morning |
| Regime `return_5d` and `range_compression` use placeholder values in signal service | No rolling price history table | Add `index_live_data` window query in `SignalService` |
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
