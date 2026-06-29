# Database Schema

Database: **StrikfinDB** (PostgreSQL 16+)
Connection: host/port with user + password (`postgresql+asyncpg://…`)
ORM: SQLAlchemy 2.0 async (asyncpg driver)

All market data tables are **append-only** — rows are inserted, never updated in place. The auth tables (`users`, `refresh_tokens`) are the only mutable tables.

---

## Tables

### `users`

Single-user platform auth. Stores the application owner's account.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `user_id` | BIGINT | No | autoincrement PK | |
| `email` | VARCHAR(255) | No | — | Unique, indexed |
| `password_hash` | VARCHAR(255) | No | — | bcrypt hash |
| `display_name` | VARCHAR(100) | Yes | NULL | |
| `is_active` | BOOLEAN | No | `True` | Soft-disable without deleting |
| `created_at` | DATETIME | No | `utcnow()` | |
| `last_login_at` | DATETIME | Yes | NULL | Updated on each login |

**Relationships:** one-to-many → `refresh_tokens`, `audit_logs`

---

### `refresh_tokens`

Stores hashed refresh tokens for token rotation. Revoked tokens are soft-deleted via `revoked_at`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `token_id` | BIGINT | No | autoincrement PK | |
| `user_id` | BIGINT | No | — | FK → `users.user_id` |
| `token_hash` | VARCHAR(255) | No | — | SHA-256 hash of raw token. Unique. |
| `expires_at` | DATETIME | No | — | |
| `revoked_at` | DATETIME | Yes | NULL | Set on logout or rotation |
| `device_info` | VARCHAR(300) | Yes | NULL | User-Agent header truncated to 300 chars |
| `created_at` | DATETIME | No | `utcnow()` | |

**Indexes:** `ix_refresh_tokens_user` on (`user_id`)

---

### `instruments`

Lookup table for the two tracked instruments.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `instrument_id` | SMALLINT | No | PK (manual) | 1 = NIFTY50, 2 = SENSEX |
| `symbol` | VARCHAR(20) | No | — | Unique. E.g. `NIFTY50`, `SENSEX` |
| `exchange` | VARCHAR(10) | No | — | `NSE` or `BSE` |
| `lot_size` | INT | No | — | Current lot size for F&O |
| `is_active` | BOOLEAN | No | `True` | |

---

### `index_live_data`

Append-only 1-minute snapshots of index prices and VIX.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `row_id` | BIGINT | No | autoincrement PK | |
| `instrument_id` | SMALLINT | No | — | FK → `instruments.instrument_id` |
| `trade_date` | DATE | No | — | Calendar date (IST) |
| `snap_ts` | DATETIME | No | — | Exact snapshot timestamp (UTC) |
| `last_price` | DECIMAL(12,2) | No | — | Last traded price |
| `open_price` | DECIMAL(12,2) | Yes | NULL | |
| `high_price` | DECIMAL(12,2) | Yes | NULL | |
| `low_price` | DECIMAL(12,2) | Yes | NULL | |
| `prev_close` | DECIMAL(12,2) | Yes | NULL | Previous day close |
| `change_pct` | DECIMAL(7,3) | Yes | NULL | % change from prev_close |
| `volume` | BIGINT | Yes | NULL | |
| `india_vix` | DECIMAL(7,3) | Yes | NULL | India VIX at this snapshot |

**Indexes:** `ix_index_live_data_lookup` on (`instrument_id`, `trade_date`, `snap_ts`)

---

### `option_chain_snapshots`

Header record for each option chain pull. Child rows live in `option_chain_rows`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `snapshot_id` | BIGINT | No | autoincrement PK | |
| `instrument_id` | SMALLINT | No | — | FK → `instruments.instrument_id` |
| `trade_date` | DATE | No | — | |
| `expiry_date` | DATE | No | — | Near-month expiry date |
| `snap_ts` | DATETIME | No | — | Snapshot timestamp (UTC) |
| `spot` | DECIMAL(12,2) | No | — | Underlying spot at this snapshot |
| `atm_strike` | DECIMAL(12,2) | No | — | At-the-money strike |
| `total_call_oi` | BIGINT | Yes | NULL | Sum of all CE OI |
| `total_put_oi` | BIGINT | Yes | NULL | Sum of all PE OI |
| `pcr_oi` | DECIMAL(8,4) | Yes | NULL | Put OI / Call OI |
| `pcr_volume` | DECIMAL(8,4) | Yes | NULL | Put Volume / Call Volume |
| `max_pain_strike` | DECIMAL(12,2) | Yes | NULL | Computed max-pain expiry price |

**Indexes:** `ix_oc_snapshots_lookup` on (`instrument_id`, `trade_date`, `snap_ts`)

---

### `option_chain_rows`

Per-strike option data, child of `option_chain_snapshots`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `row_id` | BIGINT | No | autoincrement PK | |
| `snapshot_id` | BIGINT | No | — | FK → `option_chain_snapshots.snapshot_id` |
| `trade_date` | DATE | No | — | Denormalized for fast date-only queries |
| `strike` | DECIMAL(12,2) | No | — | Strike price |
| `option_type` | CHAR(2) | No | — | `CE` or `PE` |
| `ltp` | DECIMAL(12,2) | Yes | NULL | Last traded price |
| `oi` | BIGINT | Yes | NULL | Open interest (contracts) |
| `oi_change` | BIGINT | Yes | NULL | Change in OI since last snapshot |
| `volume` | BIGINT | Yes | NULL | |
| `iv` | DECIMAL(7,3) | Yes | NULL | Implied volatility (%) |
| `delta` | DECIMAL(7,4) | Yes | NULL | Greek delta |
| `theta` | DECIMAL(9,4) | Yes | NULL | Greek theta |
| `vega` | DECIMAL(9,4) | Yes | NULL | Greek vega |
| `gamma` | DECIMAL(9,6) | Yes | NULL | Greek gamma |
| `buildup_type` | SMALLINT | Yes | NULL | 1=LongBuildup 2=ShortBuildup 3=ShortCovering 4=LongUnwinding |

**Indexes:** `ix_oc_rows_snap` on (`snapshot_id`, `option_type`, `strike`)

---

### `institutional_activity`

EOD FII/DII cash and futures flow data. Append-only.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `trade_date` | DATE | No | — | |
| `category` | VARCHAR(10) | No | — | `FII` or `DII` |
| `segment` | VARCHAR(20) | No | — | `CASH` or `IDX_FUT` |
| `buy_value_cr` | DECIMAL(16,2) | Yes | NULL | Gross buy value (₹ crore) |
| `sell_value_cr` | DECIMAL(16,2) | Yes | NULL | Gross sell value (₹ crore) |
| `net_value_cr` | DECIMAL(16,2) | Yes | NULL | Net (buy − sell) in ₹ crore |
| `long_contracts` | BIGINT | Yes | NULL | FII long contracts (IDX_FUT segment only) |
| `short_contracts` | BIGINT | Yes | NULL | FII short contracts (IDX_FUT segment only) |
| `is_provisional` | BOOLEAN | No | `True` | False once NSDL/CDSL final data confirmed |
| `source_ts` | DATETIME | No | — | When data was sourced |

**Unique constraint:** `uq_inst` on (`trade_date`, `category`, `segment`, `is_provisional`)
**Indexes:** `ix_inst_date_cat` on (`trade_date`, `category`)

---

### `news_feed`

Ingested news headlines deduplicated by SHA-256 hash.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `news_id` | BIGINT | No | autoincrement PK | |
| `source` | VARCHAR(80) | No | — | Publisher name |
| `headline` | VARCHAR(500) | No | — | |
| `url` | VARCHAR(800) | Yes | NULL | Source article URL |
| `published_at` | DATETIME | No | — | Publisher's timestamp |
| `dedup_hash` | CHAR(64) | No | — | SHA-256 of normalized headline. Unique. |
| `category` | VARCHAR(40) | Yes | NULL | `RBI` `MACRO` `GLOBAL` `EARNINGS` `INDEX` |
| `ingested_at` | DATETIME | No | `utcnow()` | |

**Indexes:** `ix_news_pub` on (`published_at`)

---

### `market_sentiment`

Scored sentiment result for each analysis run.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `instrument_id` | SMALLINT | Yes | NULL | FK → `instruments.instrument_id` (NULL = market-wide) |
| `as_of` | DATETIME | No | — | Analysis timestamp |
| `model` | VARCHAR(40) | No | — | e.g. `mock-md5` or `finbert-v1` |
| `label` | SMALLINT | No | — | `-1` Bearish · `0` Neutral · `1` Bullish |
| `score` | DECIMAL(6,4) | No | — | Aggregate score in [−1, +1] |
| `confidence` | DECIMAL(6,4) | No | — | |
| `rationale` | VARCHAR(1000) | Yes | NULL | Plain-English summary |

**Indexes:** `ix_sentiment_asof` on (`instrument_id`, `as_of`)

---

### `market_regime` — **removed**

> The standalone regime classifier (engine, service, router, and this table) has
> been removed. Bias classification now lives in the `synthesizer` engine and is
> persisted to `ai_trade_signals` (below). The ORM no longer defines this table;
> a legacy database may still contain it as an orphaned, unused table.

---

### `smart_money_signals`

Append-only per-signal records for smart-money detection.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `instrument_id` | SMALLINT | No | — | FK → `instruments.instrument_id` |
| `as_of` | DATETIME | No | — | |
| `signal_type` | SMALLINT | No | — | 1=LongBuildup 2=ShortBuildup 3=LongUnwind 4=ShortCover 5=UnusualOI 6=UnusualVol |
| `strike` | DECIMAL(12,2) | Yes | NULL | Strike where signal fired |
| `option_type` | CHAR(2) | Yes | NULL | `CE` or `PE` |
| `strength` | DECIMAL(6,4) | No | — | `abs(oi_change) / oi`, clamped 0–1 |
| `confidence` | DECIMAL(6,4) | No | — | `0.40 + strength × 0.55`, capped 0.92 |
| `evidence` | TEXT | Yes | NULL | JSON detail |

**Indexes:** `ix_sm_asof` on (`instrument_id`, `as_of`)

---

### `ai_trade_signals`

Append-only synthesized AI bias signal per run.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `instrument_id` | SMALLINT | No | — | FK → `instruments.instrument_id` |
| `as_of` | DATETIME | No | — | |
| `bias` | SMALLINT | No | — | `1` Bullish · `0` Neutral · `-1` Bearish |
| `entry_ref` | DECIMAL(12,2) | Yes | NULL | Illustrative entry (NOT advice) |
| `stop_ref` | DECIMAL(12,2) | Yes | NULL | Illustrative stop (NOT advice) |
| `target_ref` | DECIMAL(12,2) | Yes | NULL | Illustrative target (NOT advice) |
| `risk_reward` | DECIMAL(6,2) | Yes | NULL | `reward / risk` ratio |
| `confidence` | DECIMAL(6,4) | No | — | 0.30–0.95 |
| `reasoning` | TEXT | Yes | NULL | Plain-English explanation |
| `disclosure_mode` | VARCHAR(20) | No | `intelligence` | Always `intelligence` |
| `model_version` | VARCHAR(30) | No | — | e.g. `synthesizer-v1.1` |

**Indexes:** `ix_ai_signals_asof` on (`instrument_id`, `as_of`)

---

### `signal_outcomes`

One row per scored AI signal (1:1 with `ai_trade_signals` via a unique `signal_id`). Written and updated by the background scorer loop / `outcome` engine; read by `/signals/{id}/accuracy`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `signal_id` | BIGINT | No | — | **Unique** FK → `ai_trade_signals.id` |
| `instrument_id` | SMALLINT | No | — | FK → `instruments.instrument_id` |
| `bias` | SMALLINT | No | — | `1` / `0` / `-1` (copied from the signal) |
| `status` | VARCHAR(12) | No | — | `OPEN` · `WIN` · `LOSS` · `EXPIRED` · `NEUTRAL` |
| `realized_r` | DECIMAL(8,3) | Yes | NULL | Realised R-multiple once settled |
| `exit_price` | DECIMAL(12,2) | Yes | NULL | Price at hit/expiry |
| `bars_held` | INTEGER | Yes | NULL | Snapshots from issue to settle |
| `signal_as_of` | DATETIME | No | — | Timestamp of the source signal |
| `evaluated_at` | DATETIME | No | now | Last re-score time |

**Indexes:** `ix_outcome_lookup` on (`instrument_id`, `status`), `ix_outcome_signal` on (`signal_id`)

---

### `audit_logs`

Append-only security and action audit trail.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | BIGINT | No | autoincrement PK | |
| `as_of` | DATETIME | No | `utcnow()` | |
| `user_id` | BIGINT | Yes | NULL | FK → `users.user_id` (NULL for pre-auth events) |
| `action` | VARCHAR(80) | No | — | e.g. `REGISTER`, `LOGIN`, `LOGOUT` |
| `ip` | VARCHAR(45) | Yes | NULL | Client IP (supports IPv6) |
| `detail` | TEXT | Yes | NULL | JSON extra context |

**Indexes:** `ix_audit_user` on (`user_id`, `as_of`), `ix_audit_action` on (`action`, `as_of`)

---

## Entity Relationship Diagram

```mermaid
erDiagram
    users {
        bigint user_id PK
        varchar email
        varchar password_hash
        varchar display_name
        bit is_active
        datetime created_at
        datetime last_login_at
    }
    refresh_tokens {
        bigint token_id PK
        bigint user_id FK
        varchar token_hash
        datetime expires_at
        datetime revoked_at
        varchar device_info
        datetime created_at
    }
    audit_logs {
        bigint id PK
        datetime as_of
        bigint user_id FK
        varchar action
        varchar ip
        text detail
    }
    instruments {
        smallint instrument_id PK
        varchar symbol
        varchar exchange
        int lot_size
        bit is_active
    }
    index_live_data {
        bigint row_id PK
        smallint instrument_id FK
        date trade_date
        datetime snap_ts
        decimal last_price
    }
    option_chain_snapshots {
        bigint snapshot_id PK
        smallint instrument_id FK
        date trade_date
        date expiry_date
        datetime snap_ts
        decimal spot
        decimal atm_strike
    }
    option_chain_rows {
        bigint row_id PK
        bigint snapshot_id FK
        decimal strike
        char option_type
        bigint oi
        bigint oi_change
    }
    institutional_activity {
        bigint id PK
        date trade_date
        varchar category
        varchar segment
        decimal net_value_cr
    }
    news_feed {
        bigint news_id PK
        varchar source
        varchar headline
        datetime published_at
        char dedup_hash
    }
    market_sentiment {
        bigint id PK
        smallint instrument_id FK
        datetime as_of
        decimal score
    }
    smart_money_signals {
        bigint id PK
        smallint instrument_id FK
        datetime as_of
        smallint signal_type
        decimal strength
    }
    ai_trade_signals {
        bigint id PK
        smallint instrument_id FK
        datetime as_of
        smallint bias
        decimal confidence
        varchar disclosure_mode
    }

    users ||--o{ refresh_tokens : "has"
    users ||--o{ audit_logs : "generates"
    instruments ||--o{ index_live_data : "has"
    instruments ||--o{ option_chain_snapshots : "has"
    instruments ||--o{ market_sentiment : "scored for"
    instruments ||--o{ smart_money_signals : "detected on"
    instruments ||--o{ ai_trade_signals : "synthesized for"
    ai_trade_signals ||--o{ signal_outcomes : "scored by"
    option_chain_snapshots ||--o{ option_chain_rows : "contains"
```

---

## Append-only vs Mutable Tables

| Table | Mutation Policy |
|---|---|
| `users` | Mutable — `is_active`, `last_login_at` are updated |
| `refresh_tokens` | Mutable — `revoked_at` is set on logout/rotation |
| `instruments` | Mutable — `is_active` can change |
| `index_live_data` | **Append-only** |
| `option_chain_snapshots` | **Append-only** |
| `option_chain_rows` | **Append-only** |
| `institutional_activity` | Append-only (unique constraint prevents exact duplicates) |
| `news_feed` | **Append-only** (dedup_hash prevents duplicate headlines) |
| `market_sentiment` | **Append-only** |
| `smart_money_signals` | **Append-only** |
| `ai_trade_signals` | **Append-only** |
| `signal_outcomes` | Mutable — updated as a signal is re-scored, then settled (`status` OPEN→WIN/LOSS/EXPIRED/NEUTRAL) |
| `audit_logs` | **Append-only** |

---

## Views and Stored Procedures

<!-- TODO: confirm — no SQL views or stored procedures are defined in the current codebase or Alembic migrations. The alembic/versions/ directory is empty. Add entries here once views/procs are created. -->

No database views or stored procedures exist at this time. All aggregation and computation happens in the Python engine and service layers.
