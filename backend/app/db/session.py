"""
db/session.py
-------------
PostgreSQL async engine and session factory (asyncpg driver).
"""
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# ── Engine ────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,    # set SQL_ECHO=true in .env to log all SQL
    pool_pre_ping=True,        # recycles dead connections silently
    pool_size=5,
    max_overflow=10,
)

# ── Session Factory ───────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# ── Base ORM Class ────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Helpers ───────────────────────────────────────────────────
async def create_all_tables() -> None:
    """
    Creates all tables from ORM models.
    Used on startup in development.
    Production uses Alembic migrations instead.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def dispose_engine() -> None:
    """Clean shutdown — called in app lifespan."""
    await engine.dispose()