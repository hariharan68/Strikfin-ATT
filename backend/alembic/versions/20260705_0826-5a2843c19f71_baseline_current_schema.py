"""baseline current schema

Revision ID: 5a2843c19f71
Revises:
Create Date: 2026-07-05 08:26:15.771236

Baseline (version 0) for Strikfin. Represents the full schema as it exists in
the live StrikfinDB: all ORM tables/indexes PLUS the CHECK constraints, views,
and maintenance functions that previously lived only in docs/postgres_db_creation.sql.

Making this baseline authoritative means `alembic upgrade head` on a fresh DB
reproduces the exact production schema (including the critical ck_ocr_iv /
ck_ocs_future_price constraints). The already-built StrikfinDB is brought under
Alembic control with `alembic stamp head` (no DDL re-run).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.models  # noqa: F401  — provides app.db.models.UTCDateTime used below


# revision identifiers, used by Alembic.
revision: str = '5a2843c19f71'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── CHECK constraints (live in the DB, not in the ORM) ────────────────────────
# name, table, expression  — mirror the live StrikfinDB exactly.
_CHECKS: list[tuple[str, str, str]] = [
    ("ck_users_email_len",       "users",                  "char_length(email) >= 3"),
    ("ck_instruments_exchange",  "instruments",            "exchange IN ('NSE','BSE')"),
    ("ck_instruments_lot_size",  "instruments",            "lot_size > 0"),
    ("ck_ild_prices",            "index_live_data",        "last_price > 0 AND (high_price IS NULL OR low_price IS NULL OR high_price >= low_price)"),
    ("ck_ild_india_vix",         "index_live_data",        "india_vix IS NULL OR india_vix > 0"),
    ("ck_ocs_expiry",            "option_chain_snapshots", "expiry_date >= trade_date"),
    ("ck_ocs_spot",              "option_chain_snapshots", "spot > 0"),
    ("ck_ocs_future_price",      "option_chain_snapshots", "future_price IS NULL OR future_price > 0"),
    ("ck_ocs_pcr",              "option_chain_snapshots", "pcr_oi IS NULL OR pcr_oi >= 0"),
    ("ck_ocr_strike",            "option_chain_rows",      "strike > 0"),
    ("ck_ocr_option_type",       "option_chain_rows",      "option_type IN ('CE','PE')"),
    ("ck_ocr_iv",                "option_chain_rows",      "iv IS NULL OR iv > 0"),
    ("ck_ocr_buildup",           "option_chain_rows",      "buildup_type IS NULL OR (buildup_type >= 1 AND buildup_type <= 4)"),
    ("ck_ia_category",           "institutional_activity", "category IN ('FII','DII')"),
    ("ck_ia_segment",            "institutional_activity", "segment IN ('CASH','IDX_FUT','STK_FUT','IDX_OPT','STK_OPT','DEBT')"),
    ("ck_news_category",         "news_feed",              "category IS NULL OR category IN ('RBI','MACRO','GLOBAL','EARNINGS','INDEX','CORPORATE','GEOPOLITICAL')"),
    ("ck_ms_label",              "market_sentiment",       "label IN (-1,0,1)"),
    ("ck_ms_score",              "market_sentiment",       "score >= -1.0 AND score <= 1.0"),
    ("ck_ms_confidence",         "market_sentiment",       "confidence >= 0.0 AND confidence <= 1.0"),
    ("ck_sms_signal_type",       "smart_money_signals",    "signal_type >= 1 AND signal_type <= 6"),
    ("ck_sms_option_type",       "smart_money_signals",    "option_type IS NULL OR option_type IN ('CE','PE')"),
    ("ck_sms_strength",          "smart_money_signals",    "strength >= 0.0 AND strength <= 1.0"),
    ("ck_sms_confidence",        "smart_money_signals",    "confidence >= 0.0 AND confidence <= 1.0"),
    ("ck_ats_bias",              "ai_trade_signals",       "bias IN (-1,0,1)"),
    ("ck_ats_rr",                "ai_trade_signals",       "risk_reward IS NULL OR risk_reward >= 0"),
    ("ck_ats_confidence",        "ai_trade_signals",       "confidence >= 0.0 AND confidence <= 1.0"),
]

_VIEWS = ["vw_latest_index_snapshot", "vw_latest_option_snapshot", "vw_daily_institutional_summary"]
_FUNCS = ["fn_cleanup_expired_tokens(integer)", "fn_purge_old_snapshots(integer)"]


def _create_views_and_functions() -> None:
    op.execute("""
        CREATE OR REPLACE VIEW vw_latest_index_snapshot AS
        SELECT DISTINCT ON (ld.instrument_id)
            i.symbol, ld.instrument_id, ld.trade_date, ld.snap_ts, ld.last_price,
            ld.open_price, ld.high_price, ld.low_price, ld.prev_close,
            ld.change_pct, ld.volume, ld.india_vix
        FROM index_live_data ld
        JOIN instruments i ON i.instrument_id = ld.instrument_id
        ORDER BY ld.instrument_id, ld.snap_ts DESC, ld.row_id DESC;
    """)
    op.execute("""
        CREATE OR REPLACE VIEW vw_latest_option_snapshot AS
        SELECT DISTINCT ON (ocs.instrument_id)
            i.symbol, ocs.instrument_id, ocs.snapshot_id, ocs.trade_date,
            ocs.expiry_date, ocs.snap_ts, ocs.spot, ocs.future_price,
            ocs.atm_strike, ocs.total_call_oi, ocs.total_put_oi, ocs.pcr_oi,
            ocs.pcr_volume, ocs.max_pain_strike
        FROM option_chain_snapshots ocs
        JOIN instruments i ON i.instrument_id = ocs.instrument_id
        ORDER BY ocs.instrument_id, ocs.snap_ts DESC, ocs.snapshot_id DESC;
    """)
    op.execute("""
        CREATE OR REPLACE VIEW vw_daily_institutional_summary AS
        SELECT trade_date,
            max(net_value_cr) FILTER (WHERE category = 'FII' AND segment = 'CASH')    AS fii_cash_net_cr,
            max(net_value_cr) FILTER (WHERE category = 'DII' AND segment = 'CASH')    AS dii_cash_net_cr,
            max(net_value_cr) FILTER (WHERE category = 'FII' AND segment = 'IDX_FUT') AS fii_idx_fut_net_cr,
            max(long_contracts)  FILTER (WHERE category = 'FII' AND segment = 'IDX_FUT') AS fii_long_contracts,
            max(short_contracts) FILTER (WHERE category = 'FII' AND segment = 'IDX_FUT') AS fii_short_contracts,
            bool_or(is_provisional) AS is_provisional,
            max(source_ts) AS last_updated
        FROM institutional_activity
        GROUP BY trade_date;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_cleanup_expired_tokens(retention_days integer DEFAULT 7)
        RETURNS integer LANGUAGE plpgsql AS $fn$
        DECLARE
            cutoff  TIMESTAMP := (now() AT TIME ZONE 'utc') - make_interval(days => retention_days);
            deleted INTEGER;
        BEGIN
            DELETE FROM refresh_tokens
            WHERE expires_at < cutoff
               OR (revoked_at IS NOT NULL AND revoked_at < cutoff);
            GET DIAGNOSTICS deleted = ROW_COUNT;
            RETURN deleted;
        END;
        $fn$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_purge_old_snapshots(retain_days integer DEFAULT 30)
        RETURNS integer LANGUAGE plpgsql AS $fn$
        DECLARE
            cutoff  DATE := ((now() AT TIME ZONE 'utc')::date - retain_days);
            deleted INTEGER;
            total   INTEGER := 0;
        BEGIN
            DELETE FROM option_chain_snapshots WHERE trade_date < cutoff;
            GET DIAGNOSTICS deleted = ROW_COUNT; total := total + deleted;
            DELETE FROM index_live_data WHERE trade_date < cutoff;
            GET DIAGNOSTICS deleted = ROW_COUNT; total := total + deleted;
            RETURN total;
        END;
        $fn$;
    """)


def upgrade() -> None:
    # ── Tables + indexes (autogenerated from ORM) ────────────────────────────
    op.create_table('institutional_activity',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('trade_date', sa.DATE(), nullable=False),
    sa.Column('category', sa.String(length=10), nullable=False),
    sa.Column('segment', sa.String(length=20), nullable=False),
    sa.Column('buy_value_cr', sa.DECIMAL(precision=16, scale=2), nullable=True),
    sa.Column('sell_value_cr', sa.DECIMAL(precision=16, scale=2), nullable=True),
    sa.Column('net_value_cr', sa.DECIMAL(precision=16, scale=2), nullable=True),
    sa.Column('long_contracts', sa.BIGINT(), nullable=True),
    sa.Column('short_contracts', sa.BIGINT(), nullable=True),
    sa.Column('is_provisional', sa.Boolean(), nullable=False),
    sa.Column('source_ts', app.db.models.UTCDateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('trade_date', 'category', 'segment', 'is_provisional', name='uq_inst')
    )
    op.create_index('ix_inst_date_cat', 'institutional_activity', ['trade_date', 'category'], unique=False)
    op.create_table('instruments',
    # PK is manually assigned (1=NIFTY, 2=SENSEX, …) — NOT a sequence.
    # autoincrement=False keeps it a plain smallint, matching the live DB.
    sa.Column('instrument_id', sa.SmallInteger(), autoincrement=False, nullable=False),
    sa.Column('symbol', sa.String(length=20), nullable=False),
    sa.Column('exchange', sa.String(length=10), nullable=False),
    sa.Column('lot_size', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('instrument_id'),
    sa.UniqueConstraint('symbol')
    )
    op.create_table('news_feed',
    sa.Column('news_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('source', sa.String(length=80), nullable=False),
    sa.Column('headline', sa.String(length=500), nullable=False),
    sa.Column('url', sa.String(length=800), nullable=True),
    sa.Column('published_at', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('dedup_hash', sa.CHAR(length=64), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=True),
    sa.Column('ingested_at', app.db.models.UTCDateTime(), nullable=False),
    sa.PrimaryKeyConstraint('news_id'),
    sa.UniqueConstraint('dedup_hash')
    )
    op.create_index('ix_news_pub', 'news_feed', ['published_at'], unique=False)
    op.create_table('users',
    sa.Column('user_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=100), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('last_login_at', app.db.models.UTCDateTime(), nullable=True),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('ai_trade_signals',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=False),
    sa.Column('as_of', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('bias', sa.SmallInteger(), nullable=False),
    sa.Column('entry_ref', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('stop_ref', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('target_ref', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('risk_reward', sa.DECIMAL(precision=6, scale=2), nullable=True),
    sa.Column('confidence', sa.DECIMAL(precision=6, scale=4), nullable=False),
    sa.Column('reasoning', sa.TEXT(), nullable=True),
    sa.Column('disclosure_mode', sa.String(length=20), nullable=False),
    sa.Column('model_version', sa.String(length=30), nullable=False),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ai_signals_asof', 'ai_trade_signals', ['instrument_id', 'as_of'], unique=False)
    op.create_table('audit_logs',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('as_of', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('user_id', sa.BIGINT(), nullable=True),
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('ip', sa.String(length=45), nullable=True),
    sa.Column('detail', sa.TEXT(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_action', 'audit_logs', ['action', 'as_of'], unique=False)
    op.create_index('ix_audit_user', 'audit_logs', ['user_id', 'as_of'], unique=False)
    op.create_table('index_live_data',
    sa.Column('row_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=False),
    sa.Column('trade_date', sa.DATE(), nullable=False),
    sa.Column('snap_ts', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('last_price', sa.DECIMAL(precision=12, scale=2), nullable=False),
    sa.Column('open_price', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('high_price', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('low_price', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('prev_close', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('change_pct', sa.DECIMAL(precision=7, scale=3), nullable=True),
    sa.Column('volume', sa.BIGINT(), nullable=True),
    sa.Column('india_vix', sa.DECIMAL(precision=7, scale=3), nullable=True),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.PrimaryKeyConstraint('row_id')
    )
    op.create_index('ix_index_live_data_lookup', 'index_live_data', ['instrument_id', 'trade_date', 'snap_ts'], unique=False)
    op.create_table('market_sentiment',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=True),
    sa.Column('as_of', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('model', sa.String(length=40), nullable=False),
    sa.Column('label', sa.SmallInteger(), nullable=False),
    sa.Column('score', sa.DECIMAL(precision=6, scale=4), nullable=False),
    sa.Column('confidence', sa.DECIMAL(precision=6, scale=4), nullable=False),
    sa.Column('rationale', sa.String(length=1000), nullable=True),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sentiment_asof', 'market_sentiment', ['instrument_id', 'as_of'], unique=False)
    op.create_table('option_chain_snapshots',
    sa.Column('snapshot_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=False),
    sa.Column('trade_date', sa.DATE(), nullable=False),
    sa.Column('expiry_date', sa.DATE(), nullable=False),
    sa.Column('snap_ts', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('spot', sa.DECIMAL(precision=12, scale=2), nullable=False),
    sa.Column('future_price', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('atm_strike', sa.DECIMAL(precision=12, scale=2), nullable=False),
    sa.Column('total_call_oi', sa.BIGINT(), nullable=True),
    sa.Column('total_put_oi', sa.BIGINT(), nullable=True),
    sa.Column('pcr_oi', sa.DECIMAL(precision=8, scale=4), nullable=True),
    sa.Column('pcr_volume', sa.DECIMAL(precision=8, scale=4), nullable=True),
    sa.Column('max_pain_strike', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.PrimaryKeyConstraint('snapshot_id')
    )
    op.create_index('ix_oc_snapshots_lookup', 'option_chain_snapshots', ['instrument_id', 'trade_date', 'snap_ts'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('token_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.BIGINT(), nullable=False),
    sa.Column('token_hash', sa.String(length=255), nullable=False),
    sa.Column('expires_at', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('revoked_at', app.db.models.UTCDateTime(), nullable=True),
    sa.Column('device_info', sa.String(length=300), nullable=True),
    sa.Column('created_at', app.db.models.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('token_id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index('ix_refresh_tokens_user', 'refresh_tokens', ['user_id'], unique=False)
    op.create_table('smart_money_signals',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=False),
    sa.Column('as_of', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('signal_type', sa.SmallInteger(), nullable=False),
    sa.Column('strike', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('option_type', sa.CHAR(length=2), nullable=True),
    sa.Column('strength', sa.DECIMAL(precision=6, scale=4), nullable=False),
    sa.Column('confidence', sa.DECIMAL(precision=6, scale=4), nullable=False),
    sa.Column('evidence', sa.TEXT(), nullable=True),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sm_asof', 'smart_money_signals', ['instrument_id', 'as_of'], unique=False)
    op.create_table('option_chain_rows',
    sa.Column('row_id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('snapshot_id', sa.BIGINT(), nullable=False),
    sa.Column('trade_date', sa.DATE(), nullable=False),
    sa.Column('strike', sa.DECIMAL(precision=12, scale=2), nullable=False),
    sa.Column('option_type', sa.CHAR(length=2), nullable=False),
    sa.Column('ltp', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('oi', sa.BIGINT(), nullable=True),
    sa.Column('oi_change', sa.BIGINT(), nullable=True),
    sa.Column('volume', sa.BIGINT(), nullable=True),
    sa.Column('iv', sa.DECIMAL(precision=7, scale=3), nullable=True),
    sa.Column('delta', sa.DECIMAL(precision=7, scale=4), nullable=True),
    sa.Column('theta', sa.DECIMAL(precision=9, scale=4), nullable=True),
    sa.Column('vega', sa.DECIMAL(precision=9, scale=4), nullable=True),
    sa.Column('gamma', sa.DECIMAL(precision=9, scale=6), nullable=True),
    sa.Column('buildup_type', sa.SmallInteger(), nullable=True),
    sa.ForeignKeyConstraint(['snapshot_id'], ['option_chain_snapshots.snapshot_id'], ),
    sa.PrimaryKeyConstraint('row_id')
    )
    op.create_index('ix_oc_rows_snap', 'option_chain_rows', ['snapshot_id', 'option_type', 'strike'], unique=False)
    op.create_table('signal_outcomes',
    sa.Column('id', sa.BIGINT(), autoincrement=True, nullable=False),
    sa.Column('signal_id', sa.BIGINT(), nullable=False),
    sa.Column('instrument_id', sa.SmallInteger(), nullable=False),
    sa.Column('bias', sa.SmallInteger(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('realized_r', sa.DECIMAL(precision=8, scale=3), nullable=True),
    sa.Column('exit_price', sa.DECIMAL(precision=12, scale=2), nullable=True),
    sa.Column('bars_held', sa.Integer(), nullable=True),
    sa.Column('signal_as_of', app.db.models.UTCDateTime(), nullable=False),
    sa.Column('evaluated_at', app.db.models.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['instrument_id'], ['instruments.instrument_id'], ),
    sa.ForeignKeyConstraint(['signal_id'], ['ai_trade_signals.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('signal_id')
    )
    op.create_index('ix_outcome_lookup', 'signal_outcomes', ['instrument_id', 'status'], unique=False)
    op.create_index('ix_outcome_signal', 'signal_outcomes', ['signal_id'], unique=False)

    # ── CHECK constraints (parity with live DB / docs SQL) ───────────────────
    for name, table, expr in _CHECKS:
        op.create_check_constraint(name, table, expr)

    # ── Views + maintenance functions ────────────────────────────────────────
    _create_views_and_functions()


def downgrade() -> None:
    for fn in _FUNCS:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
    for v in reversed(_VIEWS):
        op.execute(f"DROP VIEW IF EXISTS {v}")
    # CHECK constraints drop with their tables.
    op.drop_index('ix_outcome_signal', table_name='signal_outcomes')
    op.drop_index('ix_outcome_lookup', table_name='signal_outcomes')
    op.drop_table('signal_outcomes')
    op.drop_index('ix_oc_rows_snap', table_name='option_chain_rows')
    op.drop_table('option_chain_rows')
    op.drop_index('ix_sm_asof', table_name='smart_money_signals')
    op.drop_table('smart_money_signals')
    op.drop_index('ix_refresh_tokens_user', table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index('ix_oc_snapshots_lookup', table_name='option_chain_snapshots')
    op.drop_table('option_chain_snapshots')
    op.drop_index('ix_sentiment_asof', table_name='market_sentiment')
    op.drop_table('market_sentiment')
    op.drop_index('ix_index_live_data_lookup', table_name='index_live_data')
    op.drop_table('index_live_data')
    op.drop_index('ix_audit_user', table_name='audit_logs')
    op.drop_index('ix_audit_action', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index('ix_ai_signals_asof', table_name='ai_trade_signals')
    op.drop_table('ai_trade_signals')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index('ix_news_pub', table_name='news_feed')
    op.drop_table('news_feed')
    op.drop_table('instruments')
    op.drop_index('ix_inst_date_cat', table_name='institutional_activity')
    op.drop_table('institutional_activity')
