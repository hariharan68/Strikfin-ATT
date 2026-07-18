"""
db/models.py
------------
All SQLAlchemy ORM table definitions for Strikfin.
Single user application — no roles/permissions tables needed.
All market tables are append-only (no in-place updates).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BIGINT, CHAR, DATE, DECIMAL, TEXT,
    Boolean, DateTime, ForeignKey,
    Index, Integer, SmallInteger,
    String, TypeDecorator, UniqueConstraint,
    func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """TIMESTAMP column that accepts tz-aware UTC datetimes.

    The application works in tz-aware UTC, but the columns are
    TIMESTAMP WITHOUT TIME ZONE (naive). asyncpg refuses to bind an
    aware datetime to a naive column, so we normalise aware → naive-UTC
    on the way in. Values are read back naive (UTC), which matches the
    rest of the codebase (e.g. options_lab_service treats snap_ts as
    naive UTC). On MSSQL this normalisation happened implicitly; on
    PostgreSQL we do it explicitly here.
    """
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


# ─────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    user_id:      Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    email:        Mapped[str]           = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash:Mapped[str]           = mapped_column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone:        Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    state:        Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    auth_provider:Mapped[str]           = mapped_column(String(20), nullable=False, server_default=text("'email'"))
    is_active:    Mapped[bool]          = mapped_column(Boolean, default=True, nullable=False)
    created_at:   Mapped[datetime]      = mapped_column(UTCDateTime, default=_now, nullable=False)
    last_login_at:Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")
    preferences: Mapped[Optional["UserPreference"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class UserPreference(Base):
    """Per-user UI preferences (1:1 with User). Settings-page state that should
    persist across reloads/devices: theme + a couple of chart display choices."""
    __tablename__ = "user_preferences"

    user_id:           Mapped[int] = mapped_column(
        BIGINT, ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    theme:             Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # classic|warm|dark|terminal
    show_chart_tooltip:Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    call_put_scheme:   Mapped[str]  = mapped_column(String(16), nullable=False, server_default=text("'classic'"))  # classic|inverted
    created_at:        Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at:        Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now, nullable=False)

    user: Mapped["User"] = relationship(back_populates="preferences")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    token_id:   Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    user_id:    Mapped[int]           = mapped_column(BIGINT, ForeignKey("users.user_id"), nullable=False)
    token_hash: Mapped[str]           = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    device_info:Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime]      = mapped_column(UTCDateTime, default=_now, nullable=False)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user", "user_id"),
    )


# ─────────────────────────────────────────────────────────────
# BROKER CONNECTIONS  (per-user encrypted vendor tokens)
# ─────────────────────────────────────────────────────────────

class BrokerConnection(Base):
    """A user's link to a broker/data vendor (Fyers today; Zerodha/Angel/…
    later). Access/refresh tokens are stored ENCRYPTED (Fernet) — never plaintext.

    Retires the single global in-memory + .env Fyers token: connections are
    durable and per-user. `user_id` is nullable for now because the Fyers OAuth
    callback is unauthenticated (broker redirect carries no app JWT); that row is
    the implicit single-user/global connection. M5 makes it per-user/tenant.
    """
    __tablename__ = "broker_connections"

    id:                Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id:           Mapped[Optional[int]] = mapped_column(
        BIGINT, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True
    )
    broker:            Mapped[str] = mapped_column(String(20), nullable=False)  # fyers | zerodha | …
    access_token_enc:  Mapped[Optional[str]] = mapped_column(TEXT, nullable=True)
    refresh_token_enc: Mapped[Optional[str]] = mapped_column(TEXT, nullable=True)
    meta:              Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status:            Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'ACTIVE'"))  # ACTIVE|EXPIRED|REVOKED
    generated_at:      Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    expires_at:        Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at:        Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at:        Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        Index("ix_broker_conn_user_broker", "user_id", "broker"),
    )


# ─────────────────────────────────────────────────────────────
# INSTRUMENTS
# ─────────────────────────────────────────────────────────────

class Instrument(Base):
    """Instrument Master — the single source of truth for what an instrument IS.

    M1 extended this from the original 5-column reference table into a rich
    master that replaces the hardcoded per-id dicts (symbols, lot size, strike
    step, expiry rule, vendor symbols) previously scattered across providers and
    services. Read it through `app.instruments.InstrumentRef`, never by keying a
    module-level dict on a magic id.

    The market-plane FKs still reference `instrument_id` (SMALLINT); a future
    milestone may widen it to BIGINT for large symbol universes, but M1 keeps it
    SMALLINT so no FK churn is needed yet.
    """
    __tablename__ = "instruments"

    # Manually-assigned PK (1=NIFTY, 2=SENSEX, …) — no autoincrement/sequence,
    # matching the live DB. Prevents create_all from adding a spurious SERIAL.
    instrument_id: Mapped[int]  = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    # Stable external id (opaque, non-enumerable) — used by the frontend/API so
    # clients never depend on the small integer id. Server-generated.
    uid:           Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), unique=True, nullable=False, server_default=func.gen_random_uuid()
    )
    # Short root symbol (NIFTY50, SENSEX, RELIANCE…). Kept at 20 chars — the
    # long per-contract trading symbol is a separate future column, not this one.
    symbol:        Mapped[str]  = mapped_column(String(20), unique=True, nullable=False)
    exchange:      Mapped[str]  = mapped_column(String(10), nullable=False)  # NSE | BSE | MCX | CDS | …
    lot_size:      Mapped[int]  = mapped_column(Integer, nullable=False)
    is_active:     Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # ── Rich master fields (M1) — replace the hardcoded dicts ────────────────
    display_name:    Mapped[Optional[str]]   = mapped_column(String(80),  nullable=True)
    segment:         Mapped[Optional[str]]   = mapped_column(String(20),  nullable=True)   # INDEX|EQUITY|FUT|OPT|COMMODITY|CURRENCY
    instrument_type: Mapped[Optional[str]]   = mapped_column(String(20),  nullable=True)   # INDEX|EQUITY|FUTIDX|OPTIDX|…
    underlying:      Mapped[Optional[str]]   = mapped_column(String(40),  nullable=True)
    tick_size:       Mapped[Optional[float]] = mapped_column(DECIMAL(12, 4), nullable=True)
    strike_step:     Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)  # replaces mock _STEP / round(spot/50)
    expiry_rule:     Mapped[Optional[str]]   = mapped_column(String(40),  nullable=True)    # FUTURES expiry (monthly), replaces the last-Thursday builder
    # OPTION expiry cadence — distinct from `expiry_rule` (futures). SEBI sets
    # weekly vs monthly per index: WEEKLY_TUE (NIFTY/SENSEX) | MONTHLY_LAST_THU
    # (BANKNIFTY). Interpreted by app/market_data/expiry.upcoming_option_expiries.
    option_expiry_rule: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    # Per-vendor symbol map, e.g.
    #   {"fyers": {"spot": "NSE:NIFTY50-INDEX", "option": "NSE:NIFTY50-INDEX",
    #              "futures_template": "NSE:NIFTY{yy}{mon}FUT"}}
    vendor_symbols:  Mapped[dict]  = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # Whether the ingestion scheduler snapshots this instrument (replaces the
    # hardcoded (1, 2) tuple in scheduler.py — adopted in M3).
    snapshot_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    status:          Mapped[str]   = mapped_column(String(20), nullable=False, server_default=text("'ACTIVE'"))  # ACTIVE|DELISTED|SUSPENDED


# ─────────────────────────────────────────────────────────────
# LIVE INDEX DATA  (1-min snapshots)
# ─────────────────────────────────────────────────────────────

class IndexLiveData(Base):
    __tablename__ = "index_live_data"

    row_id:        Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    instrument_id: Mapped[int]           = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=False)
    trade_date:    Mapped[datetime]      = mapped_column(DATE, nullable=False)
    snap_ts:       Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    last_price:    Mapped[float]         = mapped_column(DECIMAL(12, 2), nullable=False)
    open_price:    Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    high_price:    Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    low_price:     Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    prev_close:    Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    change_pct:    Mapped[Optional[float]] = mapped_column(DECIMAL(7, 3), nullable=True)
    volume:        Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    india_vix:     Mapped[Optional[float]] = mapped_column(DECIMAL(7, 3), nullable=True)

    __table_args__ = (
        Index("ix_index_live_data_lookup", "instrument_id", "trade_date", "snap_ts"),
    )


# ─────────────────────────────────────────────────────────────
# OPTION CHAIN
# ─────────────────────────────────────────────────────────────

class OptionChainSnapshot(Base):
    __tablename__ = "option_chain_snapshots"

    snapshot_id:    Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    instrument_id:  Mapped[int]           = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=False)
    trade_date:     Mapped[datetime]      = mapped_column(DATE, nullable=False)
    expiry_date:    Mapped[datetime]      = mapped_column(DATE, nullable=False)
    snap_ts:        Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    spot:           Mapped[float]         = mapped_column(DECIMAL(12, 2), nullable=False)
    # Tradable current-month FUTURES price captured with this snapshot. Options
    # Lab price overlays (Multi OI & Volume, etc.) plot the FUTURES price — the
    # instrument traders actually deal — not the index spot. Nullable: rows
    # captured before this column existed (or when the futures fetch failed)
    # fall back to `spot` on read. See options_lab_service.get_oi_series.
    future_price:   Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    # Contract lot size IN EFFECT when this snapshot was captured. Lot sizes are
    # SEBI-controlled and change over time; freezing the value here keeps
    # historical lot-scaled reads (GEX notional, "Show Lot") correct after a
    # change. Nullable: rows captured before this column existed fall back to
    # the instrument master on read — see options_lab_service._lot_of.
    lot_size:       Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    atm_strike:     Mapped[float]         = mapped_column(DECIMAL(12, 2), nullable=False)
    total_call_oi:  Mapped[Optional[int]] = mapped_column(BIGINT, nullable=True)
    total_put_oi:   Mapped[Optional[int]] = mapped_column(BIGINT, nullable=True)
    pcr_oi:         Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    pcr_volume:     Mapped[Optional[float]] = mapped_column(DECIMAL(8, 4), nullable=True)
    max_pain_strike:Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)

    rows: Mapped[list["OptionChainRow"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_oc_snapshots_lookup", "instrument_id", "trade_date", "snap_ts"),
    )


class OptionChainRow(Base):
    __tablename__ = "option_chain_rows"

    row_id:       Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    snapshot_id:  Mapped[int]           = mapped_column(BIGINT, ForeignKey("option_chain_snapshots.snapshot_id"), nullable=False)
    trade_date:   Mapped[datetime]      = mapped_column(DATE, nullable=False)
    strike:       Mapped[float]         = mapped_column(DECIMAL(12, 2), nullable=False)
    option_type:  Mapped[str]           = mapped_column(CHAR(2), nullable=False)   # CE | PE
    ltp:          Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    oi:           Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    oi_change:    Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    volume:       Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    iv:           Mapped[Optional[float]] = mapped_column(DECIMAL(7, 3), nullable=True)
    delta:        Mapped[Optional[float]] = mapped_column(DECIMAL(7, 4), nullable=True)
    theta:        Mapped[Optional[float]] = mapped_column(DECIMAL(9, 4), nullable=True)
    vega:         Mapped[Optional[float]] = mapped_column(DECIMAL(9, 4), nullable=True)
    gamma:        Mapped[Optional[float]] = mapped_column(DECIMAL(9, 6), nullable=True)
    buildup_type: Mapped[Optional[int]]   = mapped_column(SmallInteger, nullable=True)
    # 1=LongBuildup 2=ShortBuildup 3=ShortCovering 4=LongUnwinding

    snapshot: Mapped["OptionChainSnapshot"] = relationship(back_populates="rows")

    __table_args__ = (
        Index("ix_oc_rows_snap", "snapshot_id", "option_type", "strike"),
    )


# ─────────────────────────────────────────────────────────────
# INSTITUTIONAL ACTIVITY  (EOD)
# ─────────────────────────────────────────────────────────────

class InstitutionalActivity(Base):
    __tablename__ = "institutional_activity"

    id:             Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    trade_date:     Mapped[datetime]      = mapped_column(DATE, nullable=False)
    category:       Mapped[str]           = mapped_column(String(10), nullable=False)  # FII | DII
    segment:        Mapped[str]           = mapped_column(String(20), nullable=False)  # CASH | IDX_FUT
    buy_value_cr:   Mapped[Optional[float]] = mapped_column(DECIMAL(16, 2), nullable=True)
    sell_value_cr:  Mapped[Optional[float]] = mapped_column(DECIMAL(16, 2), nullable=True)
    net_value_cr:   Mapped[Optional[float]] = mapped_column(DECIMAL(16, 2), nullable=True)
    long_contracts: Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    short_contracts:Mapped[Optional[int]]   = mapped_column(BIGINT, nullable=True)
    is_provisional: Mapped[bool]            = mapped_column(Boolean, default=True)
    source_ts:      Mapped[datetime]        = mapped_column(UTCDateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("trade_date", "category", "segment", "is_provisional", name="uq_inst"),
        Index("ix_inst_date_cat", "trade_date", "category"),
    )


# ─────────────────────────────────────────────────────────────
# NEWS & SENTIMENT
# ─────────────────────────────────────────────────────────────

class NewsFeed(Base):
    __tablename__ = "news_feed"

    news_id:     Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    source:      Mapped[str]           = mapped_column(String(80), nullable=False)
    headline:    Mapped[str]           = mapped_column(String(500), nullable=False)
    url:         Mapped[Optional[str]] = mapped_column(String(800), nullable=True)
    published_at:Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    dedup_hash:  Mapped[str]           = mapped_column(CHAR(64), unique=True, nullable=False)
    category:    Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    ingested_at: Mapped[datetime]      = mapped_column(UTCDateTime, default=_now, nullable=False)

    __table_args__ = (
        Index("ix_news_pub", "published_at"),
    )


class MarketSentiment(Base):
    __tablename__ = "market_sentiment"

    id:            Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    instrument_id: Mapped[Optional[int]] = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=True)
    as_of:         Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    model:         Mapped[str]           = mapped_column(String(40), nullable=False)
    label:         Mapped[int]           = mapped_column(SmallInteger, nullable=False)  # -1 | 0 | 1
    score:         Mapped[float]         = mapped_column(DECIMAL(6, 4), nullable=False)
    confidence:    Mapped[float]         = mapped_column(DECIMAL(6, 4), nullable=False)
    rationale:     Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    __table_args__ = (
        Index("ix_sentiment_asof", "instrument_id", "as_of"),
    )


# ─────────────────────────────────────────────────────────────
# SMART MONEY SIGNALS
# ─────────────────────────────────────────────────────────────

class SmartMoneySignal(Base):
    __tablename__ = "smart_money_signals"

    id:            Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    instrument_id: Mapped[int]           = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=False)
    as_of:         Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    signal_type:   Mapped[int]           = mapped_column(SmallInteger, nullable=False)
    # 1 LongBuildup 2 ShortBuildup 3 LongUnwind 4 ShortCover 5 UnusualOI 6 UnusualVol
    strike:        Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    option_type:   Mapped[Optional[str]]   = mapped_column(CHAR(2), nullable=True)
    strength:      Mapped[float]           = mapped_column(DECIMAL(6, 4), nullable=False)
    confidence:    Mapped[float]           = mapped_column(DECIMAL(6, 4), nullable=False)
    evidence:      Mapped[Optional[str]]   = mapped_column(TEXT, nullable=True)  # JSON

    __table_args__ = (
        Index("ix_sm_asof", "instrument_id", "as_of"),
    )


# ─────────────────────────────────────────────────────────────
# AI TRADE SIGNALS
# ─────────────────────────────────────────────────────────────

class AITradeSignal(Base):
    __tablename__ = "ai_trade_signals"

    id:              Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    instrument_id:   Mapped[int]           = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=False)
    as_of:           Mapped[datetime]      = mapped_column(UTCDateTime, nullable=False)
    bias:            Mapped[int]           = mapped_column(SmallInteger, nullable=False)  # 1 | 0 | -1
    entry_ref:       Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    stop_ref:        Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    target_ref:      Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    risk_reward:     Mapped[Optional[float]] = mapped_column(DECIMAL(6, 2), nullable=True)
    confidence:      Mapped[float]           = mapped_column(DECIMAL(6, 4), nullable=False)
    reasoning:       Mapped[Optional[str]]   = mapped_column(TEXT, nullable=True)
    disclosure_mode: Mapped[str]             = mapped_column(String(20), default="intelligence")
    model_version:   Mapped[str]             = mapped_column(String(30), nullable=False)

    __table_args__ = (
        Index("ix_ai_signals_asof", "instrument_id", "as_of"),
    )


# ─────────────────────────────────────────────────────────────
# SIGNAL OUTCOMES  (accuracy tracking — closes the feedback loop)
# ─────────────────────────────────────────────────────────────

class SignalOutcome(Base):
    __tablename__ = "signal_outcomes"

    id:           Mapped[int]      = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    signal_id:    Mapped[int]      = mapped_column(BIGINT, ForeignKey("ai_trade_signals.id"), unique=True, nullable=False)
    instrument_id:Mapped[int]      = mapped_column(SmallInteger, ForeignKey("instruments.instrument_id"), nullable=False)
    bias:         Mapped[int]      = mapped_column(SmallInteger, nullable=False)  # 1 | 0 | -1
    status:       Mapped[str]      = mapped_column(String(12), nullable=False)    # OPEN|WIN|LOSS|EXPIRED|NEUTRAL
    realized_r:   Mapped[Optional[float]] = mapped_column(DECIMAL(8, 3), nullable=True)
    exit_price:   Mapped[Optional[float]] = mapped_column(DECIMAL(12, 2), nullable=True)
    bars_held:    Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    signal_as_of: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)

    __table_args__ = (
        Index("ix_outcome_lookup", "instrument_id", "status"),
        Index("ix_outcome_signal", "signal_id"),
    )


# ─────────────────────────────────────────────────────────────
# AUDIT LOG  (append-only)
# ─────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id:          Mapped[int]           = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    as_of:       Mapped[datetime]      = mapped_column(UTCDateTime, default=_now, nullable=False)
    user_id:     Mapped[Optional[int]] = mapped_column(BIGINT, ForeignKey("users.user_id"), nullable=True)
    action:      Mapped[str]           = mapped_column(String(80), nullable=False)
    ip:          Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    detail:      Mapped[Optional[str]] = mapped_column(TEXT, nullable=True)  # JSON

    user: Mapped[Optional["User"]] = relationship(back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_user",   "user_id", "as_of"),
        Index("ix_audit_action", "action",  "as_of"),
    )


# ─────────────────────────────────────────────────────────────
# MULTI-TENANT SaaS PLANE  (M5)
# ─────────────────────────────────────────────────────────────
# Tenant-scoped tables use UUID PKs + created/updated/deleted audit columns.
# Postgres RLS policies (in the migration) key on current_setting('app.tenant_id');
# app-layer scoping in the services is the primary enforcement while the app
# runs as a superuser DB role (which bypasses RLS) — see SAAS_MIGRATION_NOTES.

class Organization(Base):
    """A tenant. Every user gets a personal org on register; teams add members."""
    __tablename__ = "organizations"

    id:            Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name:          Mapped[str]  = mapped_column(String(120), nullable=False)
    slug:          Mapped[str]  = mapped_column(String(140), unique=True, nullable=False)
    owner_user_id: Mapped[int]  = mapped_column(BIGINT, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    plan_key:      Mapped[str]  = mapped_column(String(20), nullable=False, server_default=text("'free'"))
    is_personal:   Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at:    Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at:    Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now, nullable=False)
    deleted_at:    Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        Index("ix_org_owner", "owner_user_id"),
    )


class Role(Base):
    """Named bundle of permissions (owner/admin/analyst/viewer + custom)."""
    __tablename__ = "roles"

    id:        Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    key:       Mapped[str]  = mapped_column(String(30), unique=True, nullable=False)  # owner|admin|analyst|viewer
    name:      Mapped[str]  = mapped_column(String(60), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Permission(Base):
    """A grantable capability, e.g. 'instrument.read', 'alert.write'."""
    __tablename__ = "permissions"

    id:          Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    key:         Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class RolePermission(Base):
    """Role ↔ Permission grant (many-to-many)."""
    __tablename__ = "role_permissions"

    role_id:       Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)


class Membership(Base):
    """A user's role within an organization."""
    __tablename__ = "memberships"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    org_id:     Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id:    Mapped[int]       = mapped_column(BIGINT, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    role_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False)
    status:     Mapped[str]       = mapped_column(String(20), nullable=False, server_default=text("'ACTIVE'"))  # ACTIVE|INVITED|SUSPENDED
    created_at: Mapped[datetime]  = mapped_column(UTCDateTime, default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "user_id", name="uq_membership_org_user"),
        Index("ix_membership_user", "user_id"),
        Index("ix_membership_org", "org_id"),
    )


class ApiKey(Base):
    """Per-org API key for the public REST/SDK plane. Only the hash is stored."""
    __tablename__ = "api_keys"

    id:          Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    org_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name:        Mapped[str]  = mapped_column(String(80), nullable=False)
    key_prefix:  Mapped[str]  = mapped_column(String(16), nullable=False)   # shown to the user for identification
    key_hash:    Mapped[str]  = mapped_column(String(128), unique=True, nullable=False)
    scopes:      Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_by:  Mapped[Optional[int]] = mapped_column(BIGINT, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    revoked_at:  Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at:  Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)

    __table_args__ = (
        Index("ix_api_keys_org", "org_id"),
    )


class Plan(Base):
    """A subscription tier + its limits (reference data, seeded)."""
    __tablename__ = "plans"

    id:          Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    key:         Mapped[str]  = mapped_column(String(20), unique=True, nullable=False)  # free|pro|desk|enterprise
    name:        Mapped[str]  = mapped_column(String(60), nullable=False)
    price_inr:   Mapped[int]  = mapped_column(Integer, nullable=False, server_default=text("0"))
    limits:      Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    is_active:   Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Subscription(Base):
    """An org's current plan subscription. Billing provider ref is stored but the
    live Razorpay integration is staged (see notes)."""
    __tablename__ = "subscriptions"

    id:                 Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    org_id:             Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    plan_key:           Mapped[str]  = mapped_column(String(20), nullable=False)
    status:             Mapped[str]  = mapped_column(String(20), nullable=False, server_default=text("'ACTIVE'"))  # ACTIVE|PAST_DUE|CANCELED
    provider:           Mapped[str]  = mapped_column(String(20), nullable=False, server_default=text("'manual'"))  # manual|razorpay
    provider_ref:       Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at:         Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at:         Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        Index("ix_subscriptions_org", "org_id"),
    )