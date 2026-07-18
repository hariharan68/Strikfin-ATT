"""Tests for the snapshot-frozen lot size read path (OptionsLabService._lot_of)
and the instrument-master lot fallback (incl. the BANKNIFTY seed).

Lot sizes are SEBI-controlled and time-varying: snapshot-anchored payloads must
read the lot FROZEN at capture; only NULL (pre-column) rows fall back to the
master's current value.
"""
from types import SimpleNamespace

from app.instruments import snapshot as instrument_snapshot
from app.services.options_lab_service import OptionsLabService


def test_frozen_snapshot_lot_wins_over_master():
    # Snapshot captured when NIFTY lot was 75 — must read 75 even though the
    # master (seed) currently says 65.
    snap = SimpleNamespace(lot_size=75)
    assert OptionsLabService._lot_of(snap, 1) == 75
    assert instrument_snapshot.lot_size(1) == 65  # master unchanged


def test_null_lot_falls_back_to_master():
    # Pre-column rows carry NULL → the master's current value applies.
    snap = SimpleNamespace(lot_size=None)
    assert OptionsLabService._lot_of(snap, 1) == instrument_snapshot.lot_size(1)


def test_missing_snapshot_falls_back_to_master():
    assert OptionsLabService._lot_of(None, 2) == instrument_snapshot.lot_size(2)


def test_zero_lot_treated_as_absent():
    # A 0 would corrupt every division — treat as absent, use the master.
    snap = SimpleNamespace(lot_size=0)
    assert OptionsLabService._lot_of(snap, 1) == instrument_snapshot.lot_size(1)


def test_seeded_master_lots_including_banknifty():
    # The Python seed is the fallback source of truth (DB overrides at runtime).
    assert instrument_snapshot.lot_size(1) == 65   # NIFTY
    assert instrument_snapshot.lot_size(2) == 20   # SENSEX
    assert instrument_snapshot.lot_size(3) == 30   # BANKNIFTY (new)
