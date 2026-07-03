"""
db/models.py
------------
All SQLAlchemy ORM table definitions for Strikfin.
Single user application — no roles/permissions tables needed.
All market tables are append-only (no in-place updates).
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BIGINT, CHAR, DATE, DECIMAL, TEXT,
    Boolean, DateTime, ForeignKey,
    Index, Integer, SmallInteger,
    String, TypeDecorator, UniqueConstraint,
)
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
    is_active:    Mapped[bool]          = mapped_column(Boolean, default=True, nullable=False)
    created_at:   Mapped[datetime]      = mapped_column(UTCDateTime, default=_now, nullable=False)
    last_login_at:Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")


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
# INSTRUMENTS
# ─────────────────────────────────────────────────────────────

class Instrument(Base):
    __tablename__ = "instruments"

    instrument_id: Mapped[int]  = mapped_column(SmallInteger, primary_key=True)
    symbol:        Mapped[str]  = mapped_column(String(20), unique=True, nullable=False)
    exchange:      Mapped[str]  = mapped_column(String(10), nullable=False)  # NSE | BSE
    lot_size:      Mapped[int]  = mapped_column(Integer, nullable=False)
    is_active:     Mapped[bool] = mapped_column(Boolean, default=True)


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