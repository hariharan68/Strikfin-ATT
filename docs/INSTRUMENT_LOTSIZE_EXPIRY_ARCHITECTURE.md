# Instrument Lot Size & Expiry — Architecture Notes

> **Status: IMPLEMENTED (2026-07-17).** All four recommendations below were built and
> verified the same day (Alembic `b7c41f9a2d05`): (A) `option_chain_snapshots.lot_size`
> freeze + `OptionsLabService._lot_of` fallback read; (B) real `cache.delete()` +
> `invalidate_instrument_cache` + `snapshot.refresh` on upsert (lot drill 65→75→65
> verified instant in-process); (C) `instruments.option_expiry_rule` +
> `upcoming_option_expiries` (WEEKLY_*/MONTHLY_*) + all five Options Lab tools now
> render the backend chain's `expiry_date` (hardcoded Tuesday builders deleted);
> (D) BANKNIFTY (id 3, lot 30, monthly) seeded and live end-to-end with zero
> per-tool changes. The sections below are preserved as the design rationale.
> One nuance discovered: cross-process direct-SQL edits propagate via the
> scheduler's per-tick mirror refresh (market-hours-gated) or restart — the
> *instant* path is an in-process `upsert_instruments` call.

## TL;DR

- The architecture you want **already exists**: a single-source-of-truth, layered
  instrument model. Lot size / strike step / expiry rule / vendor symbols are **not**
  hardcoded across the code — they live in the `instruments` DB table and flow outward.
- Change a lot size in **one row** → it propagates everywhere (providers → services →
  API payloads → frontend). Two caches must refresh for it to be *instant*.
- The one thing to **decide now**: historical integrity — lot size is SEBI-controlled and
  time-varying, and history is **not** currently frozen per snapshot.
- Weekly-vs-monthly expiry is the **real gap**: the expiry engine only implements
  `MONTHLY_*` rules today, and the option-expiry dropdown is hardcoded on the frontend.

---

## 1. The single control point: the `instruments` DB table

Lot size, strike step, expiry rule, tick size, and vendor symbols live in one place and
flow outward through layers. Nothing else should hardcode a per-id constant.

```
SEBI value  →  instruments DB table  (the single source of truth)
                 │        ▲
                 │        └── app/instruments/seed.py  (Python fallback / fresh-DB seed
                 │                                       — DEFAULT_INSTRUMENTS)
                 ▼
   ┌─────────────────────────────────────────────┐
   │ Layer 1 — Resolver (async, cached)           │  app/instruments/ref.py
   │   InstrumentRef + resolve_instrument()        │  (Redis/in-proc cache, 300s TTL)
   ├─────────────────────────────────────────────┤
   │ Layer 2 — Sync snapshot (hot path)           │  app/instruments/snapshot.py
   │   instrument_snapshot.lot_size(id)            │  (in-memory dict for the sync
   │   instrument_snapshot.strike_step(id)         │   market-data providers)
   ├─────────────────────────────────────────────┤
   │ Layer 3 — Consumers read the accessor         │  options_service, fyers_provider,
   │   never a hardcoded {1:65, 2:20} dict         │  mock_provider, options_math, …
   ├─────────────────────────────────────────────┤
   │ Layer 4 — API returns lot_size in payloads    │  every endpoint ships lot_size
   ├─────────────────────────────────────────────┤
   │ Layer 5 — Frontend reads data.lot_size        │  NEVER hardcodes it (the static
   │                                               │  INSTRUMENTS array has no lot size)
   └─────────────────────────────────────────────┘
```

**Key files**
- `backend/app/db/models.py` → `Instrument` (columns: `lot_size`, `strike_step`,
  `expiry_rule`, `tick_size`, `vendor_symbols` JSONB, `snapshot_enabled`, `status`, …).
- `backend/app/instruments/ref.py` → `InstrumentRef` value object + read-through async
  resolver (`resolve_instrument`, `resolve_active_instruments`), cached 300s.
- `backend/app/instruments/snapshot.py` → synchronous in-memory mirror for the hot-path
  providers (`instrument_snapshot.lot_size(id)`, `.strike_step(id)`, `.snapshot_enabled_ids()`).
- `backend/app/instruments/seed.py` → `DEFAULT_INSTRUMENTS` (Python fallback; also the
  fresh-DB seed via `_seed_instruments()` in `app/main.py`).
- `backend/app/market_data/expiry.py` → generic expiry-rule engine (futures symbol builder).
- `frontend/src/api/endpoints.ts` → static `INSTRUMENTS` has **id/label only, no lot size**;
  every tool reads `data.lot_size` from the payload; live catalog from `GET /instruments`.

**Current seeded values** (`seed.py`)

| id | symbol  | lot_size | strike_step | expiry_rule        | exchange |
|----|---------|----------|-------------|--------------------|----------|
| 1  | NIFTY50 | 65       | 50          | MONTHLY_LAST_THU   | NSE      |
| 2  | SENSEX  | 20       | 100         | MONTHLY_LAST_THU   | BSE      |

---

## 2. Changing a lot size (e.g. SEBI moves NIFTY 65 → 75)

You change **one row**:
- Live DB: `UPDATE instruments SET lot_size = 75 WHERE instrument_id = 1;`
  (or via the instrument upsert service), **and** edit `seed.py` so fresh dev DBs match.

Then it propagates — but note the two caches that gate "instant":

1. **`ref.py` resolver cache** — 300s TTL. `invalidate_instrument_cache()` is currently a
   **TTL-only no-op** (the cache facade has no `delete()` yet), so a stale value can linger
   up to ~5 minutes.
2. **`snapshot.py` in-memory dict** — hydrated at startup, periodically by the scheduler,
   and via `refresh(db)` after an upsert. A **direct** DB edit (not via the upsert service)
   needs a `refresh()` call or a restart.
3. **Frontend** — payload-driven, so it's correct as soon as the backend serves the new
   value; the `/instruments` catalog has its own fetch.

➡️ To make it truly "change once, reflect everywhere, immediately": give the cache facade a
real `delete()` and call `snapshot.refresh()` on every instrument upsert.

---

## 3. Decision to make NOW — historical integrity

Lot size is **SEBI-controlled and time-varying**, but history is **not** frozen today:
- `option_chain_snapshots` has **no `lot_size` column** — old snapshots don't record the lot
  that was in effect when captured.
- Consequence: the day a lot changes, any **recomputation over old data** (GEX notional,
  "Show Lot" conversions) silently uses the *new* lot → historical charts shift retroactively.

**Why it mostly hasn't bitten yet:** most persisted market data is **raw OI in contracts**,
which is lot-*independent*; lot is applied at the *display/compute edge* (`fmtOI` show-lot,
GEX `spot²·lot`). So the blast radius is small — but not zero.

| Option | What | Trade-off |
|---|---|---|
| **A — Master-only (current)** | One current value; history recomputes with today's lot | Simple; historically *inaccurate* after any lot change |
| **B — Freeze per snapshot (recommended)** | Add `lot_size` (+ optional expiry meta) to `option_chain_snapshots` at capture; live reads the master, history reads the frozen value | Correct forever; one nullable column + read fallback — same pattern already used for `future_price` |

---

## 4. Weekly vs monthly expiry — the real gap

- `app/market_data/expiry.py` is generic and rule-driven (`expiry_rule` from the master),
  **but only `MONTHLY_LAST_*` rules are implemented**. `WEEKLY_*` is explicitly flagged as
  future (M3).
- Subtlety: `expiry.py` builds the **futures** symbol (index futures *are* monthly). "NIFTY/
  SENSEX weekly" refers to **options** expiry — a separate concept. Right now the **option
  expiry dropdown is hardcoded on the frontend** (`nearestExpiry()` / `upcomingExpiries()`
  assume a fixed weekly weekday), and the backend simply serves whatever nearest-expiry chain
  Fyers returns. So option-expiry is **not yet master-driven**.

➡️ To support per-instrument weekly/monthly properly: extend `expiry.py` with `WEEKLY_*`
rules and drive the option-expiry list from the master (not the hardcoded frontend helper).

---

## 5. Adding BANKNIFTY (lot 30, monthly)

Mechanically trivial and proves the design:
- Add a `DEFAULT_INSTRUMENTS` dict in `seed.py` (`instrument_id: 3`, `symbol: "BANKNIFTY"`,
  `lot_size: 30`, `strike_step`, `vendor_symbols.fyers.{spot,option,futures_template}`,
  `expiry_rule`, `snapshot_enabled: true`) + create the DB row via the upsert service.
- **No code edits elsewhere** — providers, services, scheduler (`snapshot_enabled_ids()`),
  API, and frontend pick it up automatically.
- The only real work is the **expiry rule**: BANKNIFTY is monthly while NIFTY/SENSEX options
  are weekly — so wire the weekly/monthly distinction (Section 4) first.

---

## Recommendation (decide now)

1. **Keep the layered master** — it's the correct design; don't reintroduce hardcoded lot dicts.
2. **Adopt Option B** (freeze `lot_size` per `option_chain_snapshots` row) — cheap now, prevents
   silent historical corruption when SEBI changes a lot. Mirror the existing `future_price`
   nullable-column pattern.
3. **Tighten cache invalidation** — real `delete()` on the cache facade + `snapshot.refresh()`
   on upsert, so an admin lot edit reflects immediately instead of after the 300s TTL.
4. **Extend the expiry engine to weekly** and make the option-expiry dropdown master-driven —
   before BANKNIFTY, since it's the first monthly-vs-weekly instrument.
