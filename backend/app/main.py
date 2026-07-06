"""
app/main.py
-----------
Strikfin — FastAPI application entry point.
Wires together all routers, middleware, lifespan, and error handlers.

Run with (from the backend/ folder):
    cd backend
    uv run app.py            # preferred (uv-managed Python 3.11 env)
    # or, equivalently:
    uv run uvicorn app.main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.exceptions import AppError, to_http_exception

# ── Routers ───────────────────────────────────────────────────
from app.api.v1.routers.auth         import router as auth_router
from app.api.v1.routers.tenancy      import router as tenancy_router
from app.api.v1.routers.preferences  import router as preferences_router
from app.api.v1.routers.dashboard    import router as dashboard_router
from app.api.v1.routers.instruments  import router as instruments_router
from app.api.v1.routers.index        import router as index_router
from app.api.v1.routers.options      import router as options_router
from app.api.v1.routers.options_lab  import router as options_lab_router
from app.api.v1.routers.future_lab   import router as future_lab_router
from app.api.v1.routers.signals      import router as signals_router
from app.api.v1.routers.smart_money  import router as smart_money_router
from app.api.v1.routers.institutional import router as institutional_router
from app.api.v1.routers.sentiment    import router as sentiment_router
from app.api.v1.routers.copilot      import router as copilot_router
from app.api.v1.routers.fyers_auth import router as fyers_auth_router
from app.websocket.router      import router as ws_router

# ── Logger ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
# Keep the console clean: silence chatty third-party loggers regardless of DEBUG.
# (SQL echo is controlled separately via settings.SQL_ECHO.)
for _noisy in ("urllib3", "httpx", "httpcore", "sqlalchemy.engine"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# LIFESPAN
# ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: create DB tables + seed instruments.
    Shutdown: dispose DB engine cleanly.
    """
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION} ...")

    # Schema is Alembic-managed (single source of truth). In development we run
    # `alembic upgrade head` at startup for convenience so a fresh checkout is
    # ready without a manual step. We do NOT use Base.metadata.create_all — it
    # creates tables ahead of migrations, which then fail ("already exists") and
    # skips seed/RLS. Prod runs `alembic upgrade head` in the deploy pipeline.
    if settings.APP_ENV == "development":
        try:
            await _run_migrations()
            logger.info("✓ Database migrated to head (Alembic)")
        except Exception as e:
            logger.error(f"✗ DB migration failed: {e}")
            logger.warning("  Continuing — check PostgreSQL / run `uv run alembic upgrade head`")

        try:
            await _seed_instruments()
            logger.info("✓ Instruments seeded")
        except Exception as e:
            logger.warning(f"  Instrument seed skipped: {e}")

    # Hydrate the sync instrument snapshot the market-data providers read from
    # (symbols / strike_step / expiry_rule) — replaces their hardcoded dicts.
    try:
        from app.db.session import AsyncSessionLocal
        from app.instruments import snapshot as instrument_snapshot
        async with AsyncSessionLocal() as _db:
            n = await instrument_snapshot.refresh(_db)
        logger.info(f"✓ Instrument snapshot hydrated ({n} active)")
    except Exception as e:
        logger.warning(f"  Instrument snapshot hydration skipped: {e}")

    # Hydrate the in-memory Fyers token from the durable encrypted DB store
    # (broker_connections). Falls back to the .env value already in token_store.
    try:
        from app.db.session import AsyncSessionLocal
        from app.brokers.connections import load_fyers_token_into_store
        async with AsyncSessionLocal() as _db:
            await load_fyers_token_into_store(_db)
    except Exception as e:
        logger.warning(f"  Fyers token hydration skipped: {e}")

    # Background ingestion + signal scoring (real ATR/ADX history + accuracy)
    try:
        from app.ingestion.scheduler import start_background_jobs
        start_background_jobs()
    except Exception as e:
        logger.warning(f"  Background jobs not started: {e}")

    # Real-time WS publisher (pushes live quotes/OI to subscribers)
    try:
        from app.websocket.publisher import start_publisher
        start_publisher()
    except Exception as e:
        logger.warning(f"  WS publisher not started: {e}")

    from app.core.banner import print_startup_banner
    print_startup_banner()

    yield

    # Shutdown
    logger.info("Shutting down Strikfin...")
    try:
        from app.ingestion.scheduler import stop_background_jobs
        await stop_background_jobs()
    except Exception:
        pass
    try:
        from app.websocket.publisher import stop_publisher
        await stop_publisher()
    except Exception:
        pass
    from app.db.session import dispose_engine
    await dispose_engine()
    logger.info("✓ DB engine disposed. Goodbye.")


async def _run_migrations() -> None:
    """Bring the DB schema to head via Alembic. Runs in a worker thread because
    Alembic's env.py drives its own asyncio loop (asyncio.run), which can't be
    nested inside the running lifespan loop."""
    import asyncio
    from pathlib import Path
    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parent.parent  # …/backend
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    await asyncio.to_thread(command.upgrade, cfg, "head")


async def _seed_instruments() -> None:
    """
    Upsert the built-in instruments (NIFTY50, SENSEX) with their full master
    data from app/instruments/seed.py. Idempotent — safe to call on every
    startup. Rich attributes (strike_step, expiry_rule, vendor_symbols, …) live
    in the DB, not in hardcoded per-id dicts.
    """
    from app.db.session import AsyncSessionLocal
    from app.instruments.service import upsert_instruments
    from app.instruments.seed import DEFAULT_INSTRUMENTS

    async with AsyncSessionLocal() as db:
        await upsert_instruments(db, DEFAULT_INSTRUMENTS)
        await db.commit()


# ─────────────────────────────────────────────────────────────
# APP FACTORY
# ─────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="Strikfin",
        description=(
            "Institutional-grade AI trading intelligence terminal "
            "for NIFTY 50 and SENSEX. "
            "All outputs are market intelligence only — "
            "NOT investment advice. "
            "AI usage disclosed per SEBI guidelines."
        ),
        version=settings.APP_VERSION,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Domain error handler ──────────────────────────────────
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        http_exc = to_http_exception(exc)
        return JSONResponse(
            status_code=http_exc.status_code,
            content={"error": http_exc.detail},
        )

    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception):
        logger.exception(f"Unhandled error on {request.url}: {exc}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}},
        )

    # ── Mount routers ─────────────────────────────────────────
    PREFIX = "/api/v1"

    app.include_router(auth_router,          prefix=PREFIX)
    app.include_router(tenancy_router,       prefix=PREFIX)
    app.include_router(preferences_router,   prefix=PREFIX)
    app.include_router(dashboard_router,     prefix=PREFIX)
    app.include_router(instruments_router,   prefix=PREFIX)
    app.include_router(index_router,         prefix=PREFIX)
    app.include_router(options_router,       prefix=PREFIX)
    app.include_router(options_lab_router,   prefix=PREFIX)
    app.include_router(future_lab_router,    prefix=PREFIX)

    app.include_router(signals_router,       prefix=PREFIX)
    app.include_router(smart_money_router,   prefix=PREFIX)
    app.include_router(institutional_router, prefix=PREFIX)
    app.include_router(sentiment_router,     prefix=PREFIX)
    app.include_router(copilot_router,       prefix=PREFIX)
    app.include_router(fyers_auth_router,    prefix=PREFIX)  # ← ADD HERE
    app.include_router(ws_router,            prefix=PREFIX)  # WSS /api/v1/ws

    # ── Health check ──────────────────────────────────────────
    @app.get("/health", tags=["health"])
    async def health():
        return {
            "status":  "ok",
            "app":     settings.APP_NAME,
            "env":     settings.APP_ENV,
            "vendor":  settings.MARKET_DATA_VENDOR,
            "llm":     settings.LLM_PROVIDER,
        }

    @app.get("/", tags=["health"])
    async def root():
        return {
            "app":    "Strikfin",
            "docs":   "/api/docs",
            "health": "/health",
        }

    return app


# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────

app = create_app()