"""
app/main.py
-----------
Alphalytic AI — FastAPI application entry point.
Wires together all routers, middleware, lifespan, and error handlers.

Run with:
    cd backend
    uvicorn app.main:app --reload --port 8000
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
from app.api.v1.routers.dashboard    import router as dashboard_router
from app.api.v1.routers.index        import router as index_router
from app.api.v1.routers.options      import router as options_router
from app.api.v1.routers.options_lab  import router as options_lab_router
from app.api.v1.routers.signals      import router as signals_router
from app.api.v1.routers.smart_money  import router as smart_money_router
from app.api.v1.routers.institutional import router as institutional_router
from app.api.v1.routers.sentiment    import router as sentiment_router
from app.api.v1.routers.copilot      import router as copilot_router
from app.api.v1.routers.fyers_auth import router as fyers_auth_router

# ── Logger ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
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
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info("  Alphalytic AI — starting up")
    logger.info(f"  ENV    : {settings.APP_ENV}")
    logger.info(f"  VENDOR : {settings.MARKET_DATA_VENDOR}")
    logger.info(f"  LLM    : {settings.LLM_PROVIDER}")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    # Auto-create tables in development
    # Production uses Alembic migrations instead
    if settings.APP_ENV == "development":
        try:
            from app.db.session import create_all_tables
            await create_all_tables()
            logger.info("✓ Database tables ready")
        except Exception as e:
            logger.error(f"✗ DB table creation failed: {e}")
            logger.warning("  Continuing without DB — check MSSQL connection")

        try:
            await _seed_instruments()
            logger.info("✓ Instruments seeded")
        except Exception as e:
            logger.warning(f"  Instrument seed skipped: {e}")

    # Background ingestion + signal scoring (real ATR/ADX history + accuracy)
    try:
        from app.ingestion.scheduler import start_background_jobs
        start_background_jobs()
    except Exception as e:
        logger.warning(f"  Background jobs not started: {e}")

    logger.info("✓ Alphalytic AI is ready")
    logger.info("  Docs : http://localhost:8000/api/docs")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    yield

    # Shutdown
    logger.info("Shutting down Alphalytic AI...")
    try:
        from app.ingestion.scheduler import stop_background_jobs
        await stop_background_jobs()
    except Exception:
        pass
    from app.db.session import dispose_engine
    await dispose_engine()
    logger.info("✓ DB engine disposed. Goodbye.")


async def _seed_instruments() -> None:
    """
    Insert NIFTY50 and SENSEX rows if they don't already exist.
    Safe to call multiple times — checks before inserting.
    """
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.db.models import Instrument

    instruments = [
        Instrument(
            instrument_id=1,
            symbol="NIFTY50",
            exchange="NSE",
            lot_size=75,
            is_active=True,
        ),
        Instrument(
            instrument_id=2,
            symbol="SENSEX",
            exchange="BSE",
            lot_size=10,
            is_active=True,
        ),
    ]

    async with AsyncSessionLocal() as db:
        for inst in instruments:
            result = await db.execute(
                select(Instrument).where(
                    Instrument.instrument_id == inst.instrument_id
                )
            )
            if not result.scalar_one_or_none():
                db.add(inst)
        await db.commit()


# ─────────────────────────────────────────────────────────────
# APP FACTORY
# ─────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="Alphalytic AI",
        description=(
            "Institutional-grade AI trading intelligence terminal "
            "for NIFTY 50 and SENSEX. "
            "All outputs are market intelligence only — "
            "NOT investment advice. "
            "AI usage disclosed per SEBI guidelines."
        ),
        version="1.0.0",
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
    app.include_router(dashboard_router,     prefix=PREFIX)
    app.include_router(index_router,         prefix=PREFIX)
    app.include_router(options_router,       prefix=PREFIX)
    app.include_router(options_lab_router,   prefix=PREFIX)

    app.include_router(signals_router,       prefix=PREFIX)
    app.include_router(smart_money_router,   prefix=PREFIX)
    app.include_router(institutional_router, prefix=PREFIX)
    app.include_router(sentiment_router,     prefix=PREFIX)
    app.include_router(copilot_router,       prefix=PREFIX)
    app.include_router(fyers_auth_router,    prefix=PREFIX)  # ← ADD HERE

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
            "app":    "Alphalytic AI",
            "docs":   "/api/docs",
            "health": "/health",
        }

    return app


# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────

app = create_app()