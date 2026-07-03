Fyers (broker)
     │  live REST calls: quotes, option chain
     ▼
app/ingestion/providers/fyers_provider.py   ← vendor-specific client
     │  (selected via MARKET_DATA_VENDOR=fyers in .env,
     │   routed through providers/__init__.py so it's swappable)
     ▼
app/ingestion/scheduler.py   — background asyncio loop, runs inside FastAPI's lifespan
     │
     ├─ every INGEST_INTERVAL_SECONDS (~15s): _snapshot_index()
     │      → writes ONE row to IndexLiveData (spot price tick)
     │
     └─ every ~5 min: _snapshot_options()
            → OptionsService.get_latest_metrics(persist=True)
            → writes ONE OptionChainSnapshot + ~120-170 OptionChainRow
              (one row per strike×CE/PE) to Postgres
     ▼
PostgreSQL  (option_chain_snapshots, option_chain_rows, index_live_data)
     ▼
app/services/options_lab_service.py → get_oi_series()
     │  reads snapshots for the trading session, groups by strike,
     │  ranks by OI/volume, shapes into OILabSeries JSON
     ▼
GET /api/v1/options-lab/oi-series/{id}   (REST, not WebSocket)
     ▼
frontend/src/api/endpoints.ts → getOILabSeries()
     ▼
frontend/src/lib/useFetch.ts   — polls this endpoint every 15s (intervalMs)
     ▼
MultiOiVolumeTool.tsx → MultiLineChart.tsx  (the SVG chart we've been fixing)