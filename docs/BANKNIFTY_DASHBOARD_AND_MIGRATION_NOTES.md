# BANKNIFTY — Dashboard Card Swap & Migration Notes

> Reference notes from the 2026-07-18 session: (1) the Intelligence Dashboard
> top-row change that put a live **BANK NIFTY** spot card in place of the AI Bias
> tile, and (2) whether adding the BANKNIFTY instrument requires a DB migration.

---

## 1. Dashboard change

**Before:** `NIFTY 50 · SENSEX · AI Bias · BANK NIFTY (Bullish, 43% confidence) · India VIX`

**After (live):**

> **NIFTY 50** 24,334.30 · **SENSEX** 78,151.45 · **BANK NIFTY** 58,521.40 (+1.63%) · **INDIA VIX** 13.15

The old "AI Bias · BANK NIFTY / Bullish / 43% confidence" card is replaced by a
live BANK NIFTY spot-price card (58,521.40, matching the real chain spot from the
Options Lab check).

### What changed — `frontend/src/pages/DashboardPage.tsx` only

- **Swapped the 3rd top card** from `AI Bias · {selected}` → a **BANK NIFTY** spot
  card, mirroring the NIFTY/SENSEX cards (live WS quote `quote:3` with a 30s
  `/dashboard` aggregate fallback + signed change badge). No blank-card risk —
  `/dashboard` already builds a card for every active instrument, so id 3 was
  available.
- **Fixed the selected-instrument ring** for 3 indices: the NIFTY card highlighted
  on `!isSensex` (which was also true for BANKNIFTY). Now each card rings on its
  own id (`instrument === 1 / 2 / 3`).
- **Added `3`** to the live-quote subscription set and a `banknifty` resolver
  (made `resolveIndex`'s legacy key optional so id 3 reads straight from the
  generic `instruments` list).
- **Cleaned up the now-unused bias bits** (`biasConfidence`, and the
  `biasLabel` / `biasToTone` / `toneClasses` imports). The AI bias itself still
  feeds the **AI Market Summary** panel and the screen-reader `BiasPill`, so
  nothing else lost it.

`tsc -b` clean; verified live in-browser. No other files touched.

> **Conscious trade-off:** this permanently replaces the top-row AI-bias tile with
> BANKNIFTY spot (the bias now lives only in the AI Market Summary panel below).
> Alternatives if wanted later: a 5-card row (keep AI Bias *and* add BANKNIFTY),
> or show the BANKNIFTY spot card only when it's the selected instrument.

---

## 2. Do I need to run a migration for the new instrument?

**Short answer: for BANKNIFTY itself, NO.** Adding an instrument is *data*, not
schema. Your local DB is already fully up to date (`b7c41f9a2d05 (head)`,
all 3 instrument rows present).

"Adding BANKNIFTY" actually involved **two different kinds of change:**

### 2a. Schema change → needs a migration (`b7c41f9a2d05`)

This was *not* about BANKNIFTY specifically — it added the two new **columns**
from the lot-size / expiry work:

- `option_chain_snapshots.lot_size`
- `instruments.option_expiry_rule`

Columns are structure, so they require Alembic. ✅ Already applied here.

### 2b. BANKNIFTY the instrument → NO migration needed

BANKNIFTY is a **row of data**, not schema. It lives in
`app/instruments/seed.py` (`DEFAULT_INSTRUMENTS`) and is inserted by an
**idempotent upsert that runs automatically on every backend startup**
(`_seed_instruments()` in `app/main.py`). Adding/editing an instrument never
needs a migration — that's the whole point of the DB-driven instrument master.
✅ DB shows all 3 rows (NIFTY, SENSEX, BANKNIFTY).

### So, do you need `alembic upgrade head`?

| Situation | Action |
|---|---|
| **This machine (dev)** | Nothing — already at head, BANKNIFTY seeded. In dev the backend also **auto-runs migrations + seed on startup** (`APP_ENV=development`), so a restart is self-healing. |
| **A different DB** (production, teammate, a fresh `StrikfinDB`) | Yes — run `uv run alembic upgrade head` once (applies the new columns), then start the backend (the startup upsert seeds BANKNIFTY). Or, for a from-scratch DB, `docs/postgres_db_creation.sql` already includes both columns + the BANKNIFTY seed row. |

### Rule of thumb going forward

- **New instrument** (another index, a stock) → just add a dict to `seed.py` and
  restart. **No migration.**
- **SEBI lot-size / expiry-rule change** → edit the value (via the upsert path or
  `seed.py`) and restart. **No migration** — that's the whole lot-size-lifecycle
  design.
- **New column / table / constraint** → **migration required**
  (`alembic revision --autogenerate`, review, `upgrade head`).

**Bottom line:** for BANKNIFTY itself, no — it's data, already seeded. The only
migration in play was the schema columns, and that's already at head on your
machine.
