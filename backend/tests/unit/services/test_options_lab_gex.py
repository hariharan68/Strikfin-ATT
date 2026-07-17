"""Payload-shape tests for OptionsLabService.get_gex_series (live fallback path).

The DB-backed path shares the same point-builder; the live path lets us verify
the contract (aligned arrays, IV None passthrough, expiry_ts anchoring) without
a database.
"""
from datetime import date

import pytest

import app.services.options_lab_service as mod
from app.services.options_lab_service import OptionsLabService


@pytest.fixture
def svc():
    return OptionsLabService(db=None)


def _fake_chain():
    return {
        "expiry_date": "2026-07-14",
        "rows": [
            {"strike": 24900.0, "option_type": "CE", "oi": 1000, "iv": 12.5},
            {"strike": 24900.0, "option_type": "PE", "oi": 2000, "iv": 13.0},
            {"strike": 25000.0, "option_type": "CE", "oi": 3000, "iv": None},  # unrecoverable IV
            {"strike": 25000.0, "option_type": "PE", "oi": 3000, "iv": 11.0},
            {"strike": 25100.0, "option_type": "CE", "oi": 4000, "iv": 12.0},
            # 25100 PE leg absent on purpose
        ],
    }


@pytest.fixture(autouse=True)
def _patch_providers(monkeypatch):
    monkeypatch.setattr(mod, "get_option_chain", lambda _id: _fake_chain())
    monkeypatch.setattr(mod, "get_spot", lambda _id: {"last_price": 25000.0})


def test_live_gex_series_payload_shape(svc):
    out = svc._live_gex_series(1, window=20)

    for key in ("instrument_id", "symbol", "lot_size", "spot", "atm_strike",
                "trade_date", "expiry_date", "expiry_ts", "risk_free",
                "open_ts", "now_ts", "data_quality", "strikes", "series"):
        assert key in out, f"missing {key}"

    assert out["data_quality"] == "live_proxy"
    assert out["risk_free"] == pytest.approx(0.065)
    assert out["strikes"] == [24900.0, 25000.0, 25100.0]

    assert len(out["series"]) == 1
    pt = out["series"][0]
    n = len(out["strikes"])
    for arr in ("c_oi", "c_iv", "p_oi", "p_iv"):
        assert len(pt[arr]) == n, f"{arr} not aligned to strikes"

    assert pt["spot"] == pytest.approx(25000.0)
    assert pt["c_oi"] == [1000, 3000, 4000]
    # IV None must pass through as None (never coerced to 0) so the client
    # skips the leg instead of computing a zero-vol gamma.
    assert pt["c_iv"] == [12.5, None, 12.0]
    # Absent leg → None for both oi and iv.
    assert pt["p_oi"] == [2000, 3000, None]
    assert pt["p_iv"] == [13.0, 11.0, None]


def test_expiry_ts_is_1530_ist_on_expiry(svc):
    # 15:30 IST == 10:00 UTC
    iso = svc._expiry_ts_iso(date(2026, 7, 14))
    assert iso == "2026-07-14T10:00:00+00:00"
    assert svc._expiry_ts_iso(None) is None


def test_live_gex_series_window_slices_around_atm(svc):
    out = svc._live_gex_series(1, window=5)  # wider than the 3 strikes → all kept
    assert out["strikes"] == [24900.0, 25000.0, 25100.0]
    assert out["expiry_date"] == "2026-07-14"
    assert out["expiry_ts"] == "2026-07-14T10:00:00+00:00"
