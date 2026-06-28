"""
core/config.py
--------------
All settings loaded from .env file.
Every module imports `settings` from here.
Never read os.environ directly anywhere else.
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────
    APP_NAME: str = "Strikfin"
    APP_ENV: Literal["development", "production"] = "development"
    DEBUG: bool = False

    # ── Auth ──────────────────────────────────────────────────
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── Database (PostgreSQL) ──────────────────────────────────
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "StrikfinDB"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = ""

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ── Cache (Redis-ready) ───────────────────────────────────
    # Leave REDIS_URL empty to use the built-in in-process cache (good for
    # single-process dev). Set it (e.g. redis://localhost:6379/0) to use a
    # shared Redis hot cache across workers/restarts — no code change needed.
    REDIS_URL: str = ""
    CACHE_TTL_METRICS: int = 30   # option metrics / PCR — aligns with UI poll
    CACHE_TTL_CHAIN: int = 30     # full option chain rows
    CACHE_TTL_OI: int = 30        # options-lab OI view + multi-strike series

    # ── Market Data ───────────────────────────────────────────
    MARKET_DATA_VENDOR: Literal["mock", "fyers"] = "mock"

    # ── Ingestion & signal scoring ────────────────────────────
    # Background loop that snapshots index/option data into the history tables
    # (powers real ATR/ADX/IV-percentile and signal-outcome scoring).
    INGEST_ENABLED: bool = True
    INGEST_INTERVAL_SECONDS: int = 60          # 1-min index snapshots
    SCORER_INTERVAL_SECONDS: int = 900         # re-score signals every 15 min
    SIGNAL_EVAL_HORIZON_HOURS: int = 6         # one session before EXPIRED settle
    INGEST_MARKET_HOURS_ONLY: bool = True      # skip nights/weekends
    SIGNAL_PERSIST_MIN_INTERVAL_MINUTES: int = 5  # dedupe: min gap between same-bias rows

    # ── LLM ───────────────────────────────────────────────────
    LLM_PROVIDER: Literal["openai", "anthropic", "none"] = "none"
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # ── Fyers API ─────────────────────────────────────────────────
    FYERS_CLIENT_ID: str = ""
    FYERS_APP_ID: str = ""
    FYERS_SECRET_ID: str = ""
    FYERS_REDIRECT_URI: str = "http://127.0.0.1:8000/api/v1/auth/fyers/callback"
    FYERS_ACCESS_TOKEN: str = ""

    # ── CORS ──────────────────────────────────────────────────
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

