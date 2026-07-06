"""
alembic/env.py
--------------
Alembic migration environment for Strikfin.

Design notes
------------
- The DB URL is pulled from app.core.config.settings (backend/.env) — never
  hardcoded in alembic.ini — so migrations use the same credentials as the app.
- settings.DATABASE_URL uses the asyncpg driver; migrations run through an
  AsyncEngine and Alembic's run_sync bridge.
- target_metadata = Base.metadata with every ORM model imported, so
  `--autogenerate` sees the full schema.

Usage (from backend/, uv-managed env):
    uv run alembic upgrade head
    uv run alembic revision --autogenerate -m "message"
    uv run alembic stamp head     # mark an already-built DB as current
"""
import asyncio
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool

from alembic import context

# ── Make `app` importable when Alembic runs from backend/ ──────────
# prepend_sys_path=. in alembic.ini already adds backend/ to sys.path.
from app.core.config import settings
from app.db.session import Base

# Import every module that defines ORM tables so Base.metadata is complete.
# (Autogenerate diffs Base.metadata against the live DB; missing imports =
#  tables silently dropped from the diff.)
import app.db.models  # noqa: F401  (registers all current tables)

config = context.config

# Inject the real DB URL from settings (alembic.ini leaves it blank).
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Hook to scope autogenerate later (e.g. skip partitions). No-op for now."""
    return True


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a DB connection (`alembic upgrade --sql`)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
