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
    APP_NAME: str = "Alphalytic AI"
    APP_ENV: Literal["development", "production"] = "development"
    DEBUG: bool = True

    # ── Auth ──────────────────────────────────────────────────
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── Database (MSSQL — Windows Auth) ───────────────────────
    DB_SERVER: str = "SRIHARIHARAN\\SQLEXPRESS"
    DB_NAME: str = "AlphalyticDB"
    DB_DRIVER: str = "ODBC Driver 17 for SQL Server"

    @property
    def DATABASE_URL(self) -> str:
        """
        Builds MSSQL connection string using Windows Authentication.
        Named instance — no port number (port breaks named instances).
        Trusted_Connection=yes means no username/password needed.
        """
        driver = self.DB_DRIVER.replace(" ", "+")
        return (
            f"mssql+aioodbc://@{self.DB_SERVER}/{self.DB_NAME}"
            f"?driver={driver}"
            f"&Trusted_Connection=yes"
            f"&TrustServerCertificate=yes"
        )

    # ── Market Data ───────────────────────────────────────────
    MARKET_DATA_VENDOR: Literal["mock", "fyers"] = "mock"

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

