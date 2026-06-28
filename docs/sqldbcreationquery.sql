/*
================================================================================
  STRIKFIN — Microsoft SQL Server Database Creation Script
  Database : StrikfinDB
  Generated: 2026-06-20
  Engine   : MSSQL 2019+ (compatible with SQL Server Express)
  Auth     : Windows Authentication (Trusted_Connection)
================================================================================

  TABLE INVENTORY (execution order)
  ──────────────────────────────────
  01. users
  02. refresh_tokens
  03. instruments
  04. index_live_data
  05. option_chain_snapshots
  06. option_chain_rows
  07. institutional_activity
  08. news_feed
  09. market_sentiment
  10. market_regime
  11. smart_money_signals
  12. ai_trade_signals
  13. audit_logs

  VIEWS
  ──────────────────────────────────
  V01. vw_latest_index_snapshot
  V02. vw_latest_option_snapshot
  V03. vw_latest_regime
  V04. vw_daily_institutional_summary

  STORED PROCEDURES
  ──────────────────────────────────
  SP01. usp_cleanup_expired_tokens
  SP02. usp_purge_old_snapshots

================================================================================
*/

-- ============================================================================
-- 0. CREATE DATABASE
-- ============================================================================

USE master;
GO

IF DB_ID('StrikfinDB') IS NULL
BEGIN
    CREATE DATABASE StrikfinDB
    COLLATE SQL_Latin1_General_CP1_CI_AS;
    PRINT 'StrikfinDB created.';
END
ELSE
    PRINT 'StrikfinDB already exists — skipping CREATE DATABASE.';
GO

USE StrikfinDB;
GO

-- ============================================================================
-- 1. USERS
-- ============================================================================
-- Single-user application auth table.
-- email is unique and indexed for fast login lookups.
-- password_hash stores bcrypt hash (never plaintext).

IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        user_id       BIGINT          NOT NULL IDENTITY(1,1),
        email         NVARCHAR(255)   NOT NULL,
        password_hash NVARCHAR(255)   NOT NULL,
        display_name  NVARCHAR(100)       NULL,
        is_active     BIT             NOT NULL CONSTRAINT df_users_is_active     DEFAULT (1),
        created_at    DATETIME2(3)    NOT NULL CONSTRAINT df_users_created_at    DEFAULT (SYSUTCDATETIME()),
        last_login_at DATETIME2(3)        NULL,

        CONSTRAINT pk_users PRIMARY KEY CLUSTERED (user_id),
        CONSTRAINT uq_users_email UNIQUE (email),
        CONSTRAINT ck_users_email_len CHECK (LEN(email) >= 3)
    );

    CREATE NONCLUSTERED INDEX ix_users_email
        ON dbo.users (email)
        INCLUDE (user_id, is_active);

    PRINT '✓ Table: users';
END
ELSE
    PRINT '  Table users already exists — skipped.';
GO

-- ============================================================================
-- 2. REFRESH TOKENS
-- ============================================================================
-- Stores hashed JWT refresh tokens (raw token never stored).
-- token_hash has a unique constraint to prevent replay attacks.
-- Soft-deleted via revoked_at (not hard-deleted) for audit trail.

IF OBJECT_ID('dbo.refresh_tokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.refresh_tokens (
        token_id    BIGINT          NOT NULL IDENTITY(1,1),
        user_id     BIGINT          NOT NULL,
        token_hash  NVARCHAR(255)   NOT NULL,
        expires_at  DATETIME2(3)    NOT NULL,
        revoked_at  DATETIME2(3)        NULL,
        device_info NVARCHAR(300)       NULL,
        created_at  DATETIME2(3)    NOT NULL CONSTRAINT df_rt_created_at DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT pk_refresh_tokens PRIMARY KEY CLUSTERED (token_id),
        CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash),
        CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id)
            REFERENCES dbo.users (user_id)
            ON DELETE CASCADE
            ON UPDATE NO ACTION
    );

    CREATE NONCLUSTERED INDEX ix_refresh_tokens_user
        ON dbo.refresh_tokens (user_id)
        INCLUDE (token_hash, expires_at, revoked_at);

    CREATE NONCLUSTERED INDEX ix_refresh_tokens_expires
        ON dbo.refresh_tokens (expires_at)
        WHERE revoked_at IS NULL;

    PRINT '✓ Table: refresh_tokens';
END
ELSE
    PRINT '  Table refresh_tokens already exists — skipped.';
GO

-- ============================================================================
-- 3. INSTRUMENTS
-- ============================================================================
-- Reference/lookup table for tradeable indices.
-- Seeded on startup: NIFTY50 (id=1, NSE) and SENSEX (id=2, BSE).
-- SmallInt PK — never expected to exceed 32k rows.

IF OBJECT_ID('dbo.instruments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.instruments (
        instrument_id SMALLINT        NOT NULL,
        symbol        NVARCHAR(20)    NOT NULL,
        exchange      NVARCHAR(10)    NOT NULL,
        lot_size      INT             NOT NULL,
        is_active     BIT             NOT NULL CONSTRAINT df_instruments_active DEFAULT (1),

        CONSTRAINT pk_instruments PRIMARY KEY CLUSTERED (instrument_id),
        CONSTRAINT uq_instruments_symbol UNIQUE (symbol),
        CONSTRAINT ck_instruments_exchange CHECK (exchange IN ('NSE', 'BSE')),
        CONSTRAINT ck_instruments_lot_size CHECK (lot_size > 0)
    );

    -- Seed initial instruments
    IF NOT EXISTS (SELECT 1 FROM dbo.instruments WHERE instrument_id = 1)
        INSERT INTO dbo.instruments (instrument_id, symbol, exchange, lot_size, is_active)
        VALUES (1, 'NIFTY50', 'NSE', 75, 1);

    IF NOT EXISTS (SELECT 1 FROM dbo.instruments WHERE instrument_id = 2)
        INSERT INTO dbo.instruments (instrument_id, symbol, exchange, lot_size, is_active)
        VALUES (2, 'SENSEX', 'BSE', 10, 1);

    PRINT '✓ Table: instruments (seeded NIFTY50 + SENSEX)';
END
ELSE
    PRINT '  Table instruments already exists — skipped.';
GO

-- ============================================================================
-- 4. INDEX LIVE DATA
-- ============================================================================
-- Append-only 1-minute price snapshots for NIFTY50 and SENSEX.
-- Composite index on (instrument_id, trade_date, snap_ts) covers
-- all common query patterns: latest price, day-range lookups.

IF OBJECT_ID('dbo.index_live_data', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.index_live_data (
        row_id        BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id SMALLINT        NOT NULL,
        trade_date    DATE            NOT NULL,
        snap_ts       DATETIME2(3)    NOT NULL,
        last_price    DECIMAL(12,2)   NOT NULL,
        open_price    DECIMAL(12,2)       NULL,
        high_price    DECIMAL(12,2)       NULL,
        low_price     DECIMAL(12,2)       NULL,
        prev_close    DECIMAL(12,2)       NULL,
        change_pct    DECIMAL(7,3)        NULL,
        volume        BIGINT              NULL,
        india_vix     DECIMAL(7,3)        NULL,

        CONSTRAINT pk_index_live_data PRIMARY KEY CLUSTERED (row_id),
        CONSTRAINT fk_ild_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE NO ACTION,
        CONSTRAINT ck_ild_prices CHECK (
            last_price > 0
            AND (high_price IS NULL OR high_price >= low_price)
        ),
        CONSTRAINT ck_ild_india_vix CHECK (india_vix IS NULL OR india_vix > 0)
    );

    CREATE NONCLUSTERED INDEX ix_index_live_data_lookup
        ON dbo.index_live_data (instrument_id, trade_date, snap_ts DESC)
        INCLUDE (last_price, change_pct, india_vix);

    PRINT '✓ Table: index_live_data';
END
ELSE
    PRINT '  Table index_live_data already exists — skipped.';
GO

-- ============================================================================
-- 5. OPTION CHAIN SNAPSHOTS
-- ============================================================================
-- One row per option chain fetch. Parent of option_chain_rows.
-- PCR, max-pain, and ATM are pre-computed and stored for fast reads.

IF OBJECT_ID('dbo.option_chain_snapshots', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.option_chain_snapshots (
        snapshot_id     BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id   SMALLINT        NOT NULL,
        trade_date      DATE            NOT NULL,
        expiry_date     DATE            NOT NULL,
        snap_ts         DATETIME2(3)    NOT NULL,
        spot            DECIMAL(12,2)   NOT NULL,
        atm_strike      DECIMAL(12,2)   NOT NULL,
        total_call_oi   BIGINT              NULL,
        total_put_oi    BIGINT              NULL,
        pcr_oi          DECIMAL(8,4)        NULL,
        pcr_volume      DECIMAL(8,4)        NULL,
        max_pain_strike DECIMAL(12,2)       NULL,

        CONSTRAINT pk_option_chain_snapshots PRIMARY KEY CLUSTERED (snapshot_id),
        CONSTRAINT fk_ocs_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE NO ACTION,
        CONSTRAINT ck_ocs_spot CHECK (spot > 0),
        CONSTRAINT ck_ocs_expiry CHECK (expiry_date >= trade_date),
        CONSTRAINT ck_ocs_pcr CHECK (pcr_oi IS NULL OR pcr_oi >= 0)
    );

    CREATE NONCLUSTERED INDEX ix_oc_snapshots_lookup
        ON dbo.option_chain_snapshots (instrument_id, trade_date, snap_ts DESC)
        INCLUDE (snapshot_id, spot, atm_strike, pcr_oi, max_pain_strike);

    CREATE NONCLUSTERED INDEX ix_oc_snapshots_expiry
        ON dbo.option_chain_snapshots (instrument_id, expiry_date);

    PRINT '✓ Table: option_chain_snapshots';
END
ELSE
    PRINT '  Table option_chain_snapshots already exists — skipped.';
GO

-- ============================================================================
-- 6. OPTION CHAIN ROWS
-- ============================================================================
-- Per-strike, per-option-type detail rows linked to a snapshot.
-- buildup_type: 1=LongBuildup 2=ShortBuildup 3=ShortCovering 4=LongUnwinding
-- Greeks (delta/theta/vega/gamma) nullable — not always available from provider.

IF OBJECT_ID('dbo.option_chain_rows', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.option_chain_rows (
        row_id       BIGINT          NOT NULL IDENTITY(1,1),
        snapshot_id  BIGINT          NOT NULL,
        trade_date   DATE            NOT NULL,
        strike       DECIMAL(12,2)   NOT NULL,
        option_type  CHAR(2)         NOT NULL,
        ltp          DECIMAL(12,2)       NULL,
        oi           BIGINT              NULL,
        oi_change    BIGINT              NULL,
        volume       BIGINT              NULL,
        iv           DECIMAL(7,3)        NULL,
        delta        DECIMAL(7,4)        NULL,
        theta        DECIMAL(9,4)        NULL,
        vega         DECIMAL(9,4)        NULL,
        gamma        DECIMAL(9,6)        NULL,
        buildup_type SMALLINT            NULL,

        CONSTRAINT pk_option_chain_rows PRIMARY KEY CLUSTERED (row_id),
        CONSTRAINT fk_ocr_snapshot FOREIGN KEY (snapshot_id)
            REFERENCES dbo.option_chain_snapshots (snapshot_id)
            ON DELETE CASCADE,
        CONSTRAINT ck_ocr_option_type CHECK (option_type IN ('CE', 'PE')),
        CONSTRAINT ck_ocr_buildup CHECK (buildup_type IS NULL OR buildup_type BETWEEN 1 AND 4),
        CONSTRAINT ck_ocr_iv CHECK (iv IS NULL OR iv > 0),
        CONSTRAINT ck_ocr_strike CHECK (strike > 0)
    );

    CREATE NONCLUSTERED INDEX ix_oc_rows_snap
        ON dbo.option_chain_rows (snapshot_id, option_type, strike)
        INCLUDE (oi, oi_change, ltp, iv, buildup_type);

    CREATE NONCLUSTERED INDEX ix_oc_rows_trade_date
        ON dbo.option_chain_rows (trade_date, option_type, strike);

    PRINT '✓ Table: option_chain_rows';
END
ELSE
    PRINT '  Table option_chain_rows already exists — skipped.';
GO

-- ============================================================================
-- 7. INSTITUTIONAL ACTIVITY
-- ============================================================================
-- EOD FII/DII buy-sell-net data by segment (CASH, IDX_FUT, etc.).
-- Unique on (trade_date, category, segment, is_provisional) to allow
-- a provisional row to be followed by a confirmed row on the same date.

IF OBJECT_ID('dbo.institutional_activity', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.institutional_activity (
        id               BIGINT          NOT NULL IDENTITY(1,1),
        trade_date       DATE            NOT NULL,
        category         NVARCHAR(10)    NOT NULL,
        segment          NVARCHAR(20)    NOT NULL,
        buy_value_cr     DECIMAL(16,2)       NULL,
        sell_value_cr    DECIMAL(16,2)       NULL,
        net_value_cr     DECIMAL(16,2)       NULL,
        long_contracts   BIGINT              NULL,
        short_contracts  BIGINT              NULL,
        is_provisional   BIT             NOT NULL CONSTRAINT df_ia_provisional DEFAULT (1),
        source_ts        DATETIME2(3)    NOT NULL,

        CONSTRAINT pk_institutional_activity PRIMARY KEY CLUSTERED (id),
        CONSTRAINT uq_inst UNIQUE (trade_date, category, segment, is_provisional),
        CONSTRAINT ck_ia_category CHECK (category IN ('FII', 'DII')),
        CONSTRAINT ck_ia_segment  CHECK (segment IN ('CASH', 'IDX_FUT', 'STK_FUT', 'IDX_OPT', 'STK_OPT', 'DEBT'))
    );

    CREATE NONCLUSTERED INDEX ix_inst_date_cat
        ON dbo.institutional_activity (trade_date DESC, category)
        INCLUDE (segment, net_value_cr, long_contracts, short_contracts, is_provisional);

    PRINT '✓ Table: institutional_activity';
END
ELSE
    PRINT '  Table institutional_activity already exists — skipped.';
GO

-- ============================================================================
-- 8. NEWS FEED
-- ============================================================================
-- Deduplicated news headlines ingested from external sources.
-- dedup_hash (SHA-256 hex of headline+url) prevents duplicate inserts.
-- published_at index supports recency-sorted reads.

IF OBJECT_ID('dbo.news_feed', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.news_feed (
        news_id      BIGINT          NOT NULL IDENTITY(1,1),
        source       NVARCHAR(80)    NOT NULL,
        headline     NVARCHAR(500)   NOT NULL,
        url          NVARCHAR(800)       NULL,
        published_at DATETIME2(3)    NOT NULL,
        dedup_hash   CHAR(64)        NOT NULL,
        category     NVARCHAR(40)        NULL,
        ingested_at  DATETIME2(3)    NOT NULL CONSTRAINT df_news_ingested_at DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT pk_news_feed PRIMARY KEY CLUSTERED (news_id),
        CONSTRAINT uq_news_dedup UNIQUE (dedup_hash),
        CONSTRAINT ck_news_category CHECK (category IS NULL OR category IN (
            'RBI', 'MACRO', 'GLOBAL', 'EARNINGS', 'INDEX', 'CORPORATE', 'GEOPOLITICAL'
        ))
    );

    CREATE NONCLUSTERED INDEX ix_news_pub
        ON dbo.news_feed (published_at DESC)
        INCLUDE (source, headline, category);

    CREATE NONCLUSTERED INDEX ix_news_category
        ON dbo.news_feed (category, published_at DESC)
        WHERE category IS NOT NULL;

    PRINT '✓ Table: news_feed';
END
ELSE
    PRINT '  Table news_feed already exists — skipped.';
GO

-- ============================================================================
-- 9. MARKET SENTIMENT
-- ============================================================================
-- AI-scored market sentiment per instrument per model run.
-- label: -1=Bearish 0=Neutral 1=Bullish
-- instrument_id nullable — global-market sentiment rows have NULL.

IF OBJECT_ID('dbo.market_sentiment', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.market_sentiment (
        id            BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id SMALLINT            NULL,
        as_of         DATETIME2(3)    NOT NULL,
        model         NVARCHAR(40)    NOT NULL,
        label         SMALLINT        NOT NULL,
        score         DECIMAL(6,4)    NOT NULL,
        confidence    DECIMAL(6,4)    NOT NULL,
        rationale     NVARCHAR(1000)      NULL,

        CONSTRAINT pk_market_sentiment PRIMARY KEY CLUSTERED (id),
        CONSTRAINT fk_ms_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE SET NULL,
        CONSTRAINT ck_ms_label CHECK (label IN (-1, 0, 1)),
        CONSTRAINT ck_ms_score CHECK (score BETWEEN -1.0 AND 1.0),
        CONSTRAINT ck_ms_confidence CHECK (confidence BETWEEN 0.0 AND 1.0)
    );

    CREATE NONCLUSTERED INDEX ix_sentiment_asof
        ON dbo.market_sentiment (instrument_id, as_of DESC)
        INCLUDE (label, score, confidence, model);

    PRINT '✓ Table: market_sentiment';
END
ELSE
    PRINT '  Table market_sentiment already exists — skipped.';
GO

-- ============================================================================
-- 10. MARKET REGIME
-- ============================================================================
-- AI/rule-based market regime classification history.
-- regime codes: 1=TrendUp 2=TrendDown 3=Sideways 4=Breakout
--               5=Reversal 6=HighVol 7=LowVol
-- features column stores JSON evidence dict from the engine.

IF OBJECT_ID('dbo.market_regime', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.market_regime (
        id            BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id SMALLINT        NOT NULL,
        as_of         DATETIME2(3)    NOT NULL,
        regime        SMALLINT        NOT NULL,
        confidence    DECIMAL(6,4)    NOT NULL,
        model_version NVARCHAR(30)    NOT NULL,
        features      NVARCHAR(MAX)       NULL,   -- JSON evidence blob

        CONSTRAINT pk_market_regime PRIMARY KEY CLUSTERED (id),
        CONSTRAINT fk_mr_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE NO ACTION,
        CONSTRAINT ck_mr_regime CHECK (regime BETWEEN 1 AND 7),
        CONSTRAINT ck_mr_confidence CHECK (confidence BETWEEN 0.0 AND 1.0)
    );

    CREATE NONCLUSTERED INDEX ix_regime_asof
        ON dbo.market_regime (instrument_id, as_of DESC)
        INCLUDE (regime, confidence, model_version);

    PRINT '✓ Table: market_regime';
END
ELSE
    PRINT '  Table market_regime already exists — skipped.';
GO

-- ============================================================================
-- 11. SMART MONEY SIGNALS
-- ============================================================================
-- Detected institutional / smart-money activity signals.
-- signal_type: 1=LongBuildup 2=ShortBuildup 3=LongUnwind
--              4=ShortCover 5=UnusualOI 6=UnusualVol
-- strike + option_type nullable (index-level signals won't have these).

IF OBJECT_ID('dbo.smart_money_signals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.smart_money_signals (
        id            BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id SMALLINT        NOT NULL,
        as_of         DATETIME2(3)    NOT NULL,
        signal_type   SMALLINT        NOT NULL,
        strike        DECIMAL(12,2)       NULL,
        option_type   CHAR(2)             NULL,
        strength      DECIMAL(6,4)    NOT NULL,
        confidence    DECIMAL(6,4)    NOT NULL,
        evidence      NVARCHAR(MAX)       NULL,   -- JSON

        CONSTRAINT pk_smart_money_signals PRIMARY KEY CLUSTERED (id),
        CONSTRAINT fk_sms_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE NO ACTION,
        CONSTRAINT ck_sms_signal_type  CHECK (signal_type BETWEEN 1 AND 6),
        CONSTRAINT ck_sms_option_type  CHECK (option_type IS NULL OR option_type IN ('CE', 'PE')),
        CONSTRAINT ck_sms_strength     CHECK (strength BETWEEN 0.0 AND 1.0),
        CONSTRAINT ck_sms_confidence   CHECK (confidence BETWEEN 0.0 AND 1.0)
    );

    CREATE NONCLUSTERED INDEX ix_sm_asof
        ON dbo.smart_money_signals (instrument_id, as_of DESC)
        INCLUDE (signal_type, strike, option_type, strength, confidence);

    PRINT '✓ Table: smart_money_signals';
END
ELSE
    PRINT '  Table smart_money_signals already exists — skipped.';
GO

-- ============================================================================
-- 12. AI TRADE SIGNALS
-- ============================================================================
-- Synthesized trade bias + entry/stop/target generated by the AI engine.
-- bias: 1=Bullish 0=Neutral -1=Bearish
-- disclosure_mode: always "intelligence" per SEBI disclosure requirements.
-- reasoning stores the full LLM or rule-based explanation text.

IF OBJECT_ID('dbo.ai_trade_signals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ai_trade_signals (
        id               BIGINT          NOT NULL IDENTITY(1,1),
        instrument_id    SMALLINT        NOT NULL,
        as_of            DATETIME2(3)    NOT NULL,
        bias             SMALLINT        NOT NULL,
        entry_ref        DECIMAL(12,2)       NULL,
        stop_ref         DECIMAL(12,2)       NULL,
        target_ref       DECIMAL(12,2)       NULL,
        risk_reward      DECIMAL(6,2)        NULL,
        confidence       DECIMAL(6,4)    NOT NULL,
        reasoning        NVARCHAR(MAX)       NULL,
        disclosure_mode  NVARCHAR(20)    NOT NULL CONSTRAINT df_ats_disclosure DEFAULT ('intelligence'),
        model_version    NVARCHAR(30)    NOT NULL,

        CONSTRAINT pk_ai_trade_signals PRIMARY KEY CLUSTERED (id),
        CONSTRAINT fk_ats_instrument FOREIGN KEY (instrument_id)
            REFERENCES dbo.instruments (instrument_id)
            ON DELETE NO ACTION,
        CONSTRAINT ck_ats_bias       CHECK (bias IN (-1, 0, 1)),
        CONSTRAINT ck_ats_confidence CHECK (confidence BETWEEN 0.0 AND 1.0),
        CONSTRAINT ck_ats_rr         CHECK (risk_reward IS NULL OR risk_reward >= 0)
    );

    CREATE NONCLUSTERED INDEX ix_ai_signals_asof
        ON dbo.ai_trade_signals (instrument_id, as_of DESC)
        INCLUDE (bias, confidence, entry_ref, stop_ref, target_ref, model_version);

    PRINT '✓ Table: ai_trade_signals';
END
ELSE
    PRINT '  Table ai_trade_signals already exists — skipped.';
GO

-- ============================================================================
-- 13. AUDIT LOGS
-- ============================================================================
-- Append-only audit trail of user actions and system events.
-- user_id is nullable to capture pre-auth events (login attempts).
-- ip stores IPv4/IPv6 string (max 45 chars covers IPv6).
-- detail stores JSON payload for structured event data.

IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_logs (
        id      BIGINT          NOT NULL IDENTITY(1,1),
        as_of   DATETIME2(3)    NOT NULL CONSTRAINT df_audit_as_of DEFAULT (SYSUTCDATETIME()),
        user_id BIGINT              NULL,
        action  NVARCHAR(80)    NOT NULL,
        ip      NVARCHAR(45)        NULL,
        detail  NVARCHAR(MAX)       NULL,   -- JSON

        CONSTRAINT pk_audit_logs PRIMARY KEY CLUSTERED (id),
        CONSTRAINT fk_audit_user FOREIGN KEY (user_id)
            REFERENCES dbo.users (user_id)
            ON DELETE SET NULL
    );

    CREATE NONCLUSTERED INDEX ix_audit_user
        ON dbo.audit_logs (user_id, as_of DESC)
        WHERE user_id IS NOT NULL;

    CREATE NONCLUSTERED INDEX ix_audit_action
        ON dbo.audit_logs (action, as_of DESC);

    PRINT '✓ Table: audit_logs';
END
ELSE
    PRINT '  Table audit_logs already exists — skipped.';
GO


-- ============================================================================
-- VIEWS
-- ============================================================================

-- V01: Latest index snapshot per instrument
-- Returns the most recent price tick for NIFTY50 and SENSEX.
CREATE OR ALTER VIEW dbo.vw_latest_index_snapshot AS
SELECT
    i.symbol,
    i.exchange,
    ld.instrument_id,
    ld.trade_date,
    ld.snap_ts,
    ld.last_price,
    ld.open_price,
    ld.high_price,
    ld.low_price,
    ld.prev_close,
    ld.change_pct,
    ld.volume,
    ld.india_vix
FROM dbo.index_live_data ld
INNER JOIN dbo.instruments i ON i.instrument_id = ld.instrument_id
WHERE ld.row_id IN (
    SELECT MAX(row_id)
    FROM dbo.index_live_data
    GROUP BY instrument_id
);
GO

-- V02: Latest option chain snapshot per instrument
-- Returns the most recent option chain header metrics.
CREATE OR ALTER VIEW dbo.vw_latest_option_snapshot AS
SELECT
    i.symbol,
    ocs.instrument_id,
    ocs.snapshot_id,
    ocs.trade_date,
    ocs.expiry_date,
    ocs.snap_ts,
    ocs.spot,
    ocs.atm_strike,
    ocs.total_call_oi,
    ocs.total_put_oi,
    ocs.pcr_oi,
    ocs.pcr_volume,
    ocs.max_pain_strike
FROM dbo.option_chain_snapshots ocs
INNER JOIN dbo.instruments i ON i.instrument_id = ocs.instrument_id
WHERE ocs.snapshot_id IN (
    SELECT MAX(snapshot_id)
    FROM dbo.option_chain_snapshots
    GROUP BY instrument_id
);
GO

-- V03: Latest regime per instrument
-- Returns the most recent market regime classification.
CREATE OR ALTER VIEW dbo.vw_latest_regime AS
SELECT
    i.symbol,
    mr.instrument_id,
    mr.as_of,
    mr.regime,
    CASE mr.regime
        WHEN 1 THEN 'TrendUp'
        WHEN 2 THEN 'TrendDown'
        WHEN 3 THEN 'Sideways'
        WHEN 4 THEN 'Breakout'
        WHEN 5 THEN 'Reversal'
        WHEN 6 THEN 'HighVol'
        WHEN 7 THEN 'LowVol'
        ELSE 'Unknown'
    END AS regime_label,
    mr.confidence,
    mr.model_version
FROM dbo.market_regime mr
INNER JOIN dbo.instruments i ON i.instrument_id = mr.instrument_id
WHERE mr.id IN (
    SELECT MAX(id)
    FROM dbo.market_regime
    GROUP BY instrument_id
);
GO

-- V04: Daily institutional summary (FII + DII cash net, rolled up)
-- Useful for the institutional activity dashboard module.
CREATE OR ALTER VIEW dbo.vw_daily_institutional_summary AS
SELECT
    trade_date,
    MAX(CASE WHEN category = 'FII' AND segment = 'CASH'    THEN net_value_cr END) AS fii_cash_net_cr,
    MAX(CASE WHEN category = 'DII' AND segment = 'CASH'    THEN net_value_cr END) AS dii_cash_net_cr,
    MAX(CASE WHEN category = 'FII' AND segment = 'IDX_FUT' THEN net_value_cr END) AS fii_idx_fut_net_cr,
    MAX(CASE WHEN category = 'FII' AND segment = 'IDX_FUT' THEN long_contracts  END) AS fii_long_contracts,
    MAX(CASE WHEN category = 'FII' AND segment = 'IDX_FUT' THEN short_contracts END) AS fii_short_contracts,
    MAX(is_provisional) AS is_provisional,
    MAX(source_ts) AS last_updated
FROM dbo.institutional_activity
GROUP BY trade_date;
GO


-- ============================================================================
-- STORED PROCEDURES
-- ============================================================================

-- SP01: Purge expired and revoked refresh tokens older than N days
-- Run daily via SQL Agent job to keep refresh_tokens table lean.
CREATE OR ALTER PROCEDURE dbo.usp_cleanup_expired_tokens
    @retention_days INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @cutoff DATETIME2 = DATEADD(DAY, -@retention_days, SYSUTCDATETIME());

    DELETE FROM dbo.refresh_tokens
    WHERE expires_at < @cutoff
       OR (revoked_at IS NOT NULL AND revoked_at < @cutoff);

    PRINT CONCAT('Deleted ', @@ROWCOUNT, ' expired/revoked tokens older than ', @retention_days, ' days.');
END;
GO

-- SP02: Purge old intraday snapshots to control storage growth
-- Keeps the last N days of option_chain_snapshots + index_live_data.
-- Cascade DELETE on option_chain_rows handles child rows automatically.
CREATE OR ALTER PROCEDURE dbo.usp_purge_old_snapshots
    @retain_days INT = 30
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @cutoff DATE = DATEADD(DAY, -@retain_days, CAST(GETUTCDATE() AS DATE));

    -- Option chain snapshots (rows cascade)
    DELETE FROM dbo.option_chain_snapshots
    WHERE trade_date < @cutoff;
    PRINT CONCAT('Deleted ', @@ROWCOUNT, ' old option chain snapshots (cascade rows) before ', @cutoff);

    -- Raw index ticks
    DELETE FROM dbo.index_live_data
    WHERE trade_date < @cutoff;
    PRINT CONCAT('Deleted ', @@ROWCOUNT, ' old index live data rows before ', @cutoff);
END;
GO


-- ============================================================================
-- EXECUTION SUMMARY
-- ============================================================================
PRINT '';
PRINT '════════════════════════════════════════════════════════';
PRINT '  StrikfinDB schema creation complete.';
PRINT '  Run EXEC dbo.usp_cleanup_expired_tokens to purge tokens.';
PRINT '  Run EXEC dbo.usp_purge_old_snapshots to purge old data.';
PRINT '════════════════════════════════════════════════════════';
GO


/*
================================================================================
  ER DIAGRAM (Mermaid)
================================================================================

erDiagram

    users {
        BIGINT user_id PK
        NVARCHAR email UK
        NVARCHAR password_hash
        NVARCHAR display_name
        BIT is_active
        DATETIME2 created_at
        DATETIME2 last_login_at
    }

    refresh_tokens {
        BIGINT token_id PK
        BIGINT user_id FK
        NVARCHAR token_hash UK
        DATETIME2 expires_at
        DATETIME2 revoked_at
        NVARCHAR device_info
        DATETIME2 created_at
    }

    instruments {
        SMALLINT instrument_id PK
        NVARCHAR symbol UK
        NVARCHAR exchange
        INT lot_size
        BIT is_active
    }

    index_live_data {
        BIGINT row_id PK
        SMALLINT instrument_id FK
        DATE trade_date
        DATETIME2 snap_ts
        DECIMAL last_price
        DECIMAL open_price
        DECIMAL high_price
        DECIMAL low_price
        DECIMAL prev_close
        DECIMAL change_pct
        BIGINT volume
        DECIMAL india_vix
    }

    option_chain_snapshots {
        BIGINT snapshot_id PK
        SMALLINT instrument_id FK
        DATE trade_date
        DATE expiry_date
        DATETIME2 snap_ts
        DECIMAL spot
        DECIMAL atm_strike
        BIGINT total_call_oi
        BIGINT total_put_oi
        DECIMAL pcr_oi
        DECIMAL pcr_volume
        DECIMAL max_pain_strike
    }

    option_chain_rows {
        BIGINT row_id PK
        BIGINT snapshot_id FK
        DATE trade_date
        DECIMAL strike
        CHAR option_type
        DECIMAL ltp
        BIGINT oi
        BIGINT oi_change
        BIGINT volume
        DECIMAL iv
        DECIMAL delta
        DECIMAL theta
        DECIMAL vega
        DECIMAL gamma
        SMALLINT buildup_type
    }

    institutional_activity {
        BIGINT id PK
        DATE trade_date
        NVARCHAR category
        NVARCHAR segment
        DECIMAL buy_value_cr
        DECIMAL sell_value_cr
        DECIMAL net_value_cr
        BIGINT long_contracts
        BIGINT short_contracts
        BIT is_provisional
        DATETIME2 source_ts
    }

    news_feed {
        BIGINT news_id PK
        NVARCHAR source
        NVARCHAR headline
        NVARCHAR url
        DATETIME2 published_at
        CHAR dedup_hash UK
        NVARCHAR category
        DATETIME2 ingested_at
    }

    market_sentiment {
        BIGINT id PK
        SMALLINT instrument_id FK
        DATETIME2 as_of
        NVARCHAR model
        SMALLINT label
        DECIMAL score
        DECIMAL confidence
        NVARCHAR rationale
    }

    market_regime {
        BIGINT id PK
        SMALLINT instrument_id FK
        DATETIME2 as_of
        SMALLINT regime
        DECIMAL confidence
        NVARCHAR model_version
        NVARCHAR features
    }

    smart_money_signals {
        BIGINT id PK
        SMALLINT instrument_id FK
        DATETIME2 as_of
        SMALLINT signal_type
        DECIMAL strike
        CHAR option_type
        DECIMAL strength
        DECIMAL confidence
        NVARCHAR evidence
    }

    ai_trade_signals {
        BIGINT id PK
        SMALLINT instrument_id FK
        DATETIME2 as_of
        SMALLINT bias
        DECIMAL entry_ref
        DECIMAL stop_ref
        DECIMAL target_ref
        DECIMAL risk_reward
        DECIMAL confidence
        NVARCHAR reasoning
        NVARCHAR disclosure_mode
        NVARCHAR model_version
    }

    audit_logs {
        BIGINT id PK
        DATETIME2 as_of
        BIGINT user_id FK
        NVARCHAR action
        NVARCHAR ip
        NVARCHAR detail
    }

    users            ||--o{ refresh_tokens        : "has"
    users            ||--o{ audit_logs            : "generates"
    instruments      ||--o{ index_live_data       : "tracks"
    instruments      ||--o{ option_chain_snapshots: "has"
    instruments      ||--o{ market_sentiment      : "scored by"
    instruments      ||--o{ market_regime         : "classified by"
    instruments      ||--o{ smart_money_signals   : "emits"
    instruments      ||--o{ ai_trade_signals      : "receives"
    option_chain_snapshots ||--o{ option_chain_rows : "contains"

================================================================================

TABLE-BY-TABLE EXPLANATION
──────────────────────────

1. users
   Auth identity table. Stores bcrypt-hashed passwords (never plaintext).
   email is the login key. is_active allows soft-disable without deleting.

2. refresh_tokens
   Stores ONLY the hash of the issued refresh JWT — never the raw token.
   revoked_at enables soft-revocation while keeping the audit trail.
   expires_at enables the cleanup stored procedure to prune old rows.

3. instruments
   Static reference for tradeable indices. Seeded with NIFTY50 (NSE, lot 75)
   and SENSEX (BSE, lot 10). All market tables FK into this.

4. index_live_data
   Append-only 1-minute price snapshots. High-volume table; partitioning by
   trade_date is recommended when row count exceeds ~10M.

5. option_chain_snapshots
   One row per full option chain fetch (typically every minute).
   Stores pre-computed aggregate metrics: PCR, max-pain, total OI.
   Parent of option_chain_rows via CASCADE DELETE.

6. option_chain_rows
   Per-strike per-option-type detail linked to a snapshot.
   Greeks (delta/theta/vega/gamma) are nullable — only available when
   the data provider supplies them. buildup_type is engine-classified.

7. institutional_activity
   EOD FII/DII buy-sell-net data from exchange reports.
   is_provisional=1 rows are replaced by is_provisional=0 (confirmed)
   via the unique constraint — prevents duplicates while allowing updates.

8. news_feed
   Deduplicated news ingestion store. dedup_hash (SHA-256) prevents
   re-ingesting the same headline. category drives sentiment weighting.

9. market_sentiment
   AI-scored sentiment per instrument per model run. label ∈ {-1, 0, 1}.
   instrument_id nullable for market-wide (non-instrument) sentiment.

10. market_regime
    Rule-based/AI regime classification history. features column stores
    the JSON evidence dict produced by the engine for explainability.
    regime codes: 1=TrendUp 2=TrendDown 3=Sideways 4=Breakout
                  5=Reversal 6=HighVol 7=LowVol

11. smart_money_signals
    Detected institutional footprint signals. strike/option_type NULL for
    index-level signals. evidence JSON stores supporting data.

12. ai_trade_signals
    AI synthesizer output: directional bias + entry/stop/target levels.
    disclosure_mode is always "intelligence" per SEBI AI disclosure rules.
    reasoning stores the full explanation text for the copilot to surface.

13. audit_logs
    Append-only event log for all user actions and system events.
    user_id nullable for pre-auth events (failed logins, bot traffic).

RELATIONSHIP MAPPINGS
─────────────────────
• users (1) → (N) refresh_tokens     [CASCADE DELETE on user delete]
• users (1) → (N) audit_logs         [SET NULL on user delete]
• instruments (1) → (N) index_live_data
• instruments (1) → (N) option_chain_snapshots
• option_chain_snapshots (1) → (N) option_chain_rows  [CASCADE DELETE]
• instruments (1) → (N) institutional_activity  [no FK — date-keyed]
• instruments (1) → (N) market_sentiment        [SET NULL on delete]
• instruments (1) → (N) market_regime
• instruments (1) → (N) smart_money_signals
• instruments (1) → (N) ai_trade_signals
• news_feed — standalone (no FK to instruments; cross-market news)

NOTE: institutional_activity does NOT FK to instruments because it
tracks category/segment dimensions that span both exchanges without
mapping 1:1 to a single instrument.

OPTIMIZATION SUGGESTIONS
─────────────────────────
1. PARTITION index_live_data and option_chain_rows by trade_date
   once intraday rows exceed ~5M. Use monthly partition function.

2. Add COLUMNSTORE INDEX on option_chain_rows for analytics queries
   that aggregate OI/volume across all strikes:
   CREATE NONCLUSTERED COLUMNSTORE INDEX ncci_ocr_analytics
       ON dbo.option_chain_rows (strike, option_type, oi, oi_change, iv);

3. Add COLUMNSTORE INDEX on ai_trade_signals for historical back-analysis:
   CREATE NONCLUSTERED COLUMNSTORE INDEX ncci_ats_history
       ON dbo.ai_trade_signals (instrument_id, as_of, bias, confidence);

4. Consider READ_COMMITTED_SNAPSHOT isolation (RCSI) at DB level to
   eliminate reader/writer lock contention on append-only tables:
   ALTER DATABASE StrikfinDB SET READ_COMMITTED_SNAPSHOT ON;

5. Schedule usp_cleanup_expired_tokens daily via SQL Server Agent.
   Schedule usp_purge_old_snapshots weekly (retain 30 days default).

6. Add a filtered index on audit_logs for system (unauthenticated) events:
   CREATE INDEX ix_audit_system ON dbo.audit_logs (as_of DESC)
       WHERE user_id IS NULL;

================================================================================
*/
