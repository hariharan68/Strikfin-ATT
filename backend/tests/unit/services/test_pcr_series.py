"""Payload-shape tests for OptionsLabService.get_pcr_series (live fallback path).

The DB-backed path shares the same point-builder + synthetic-open logic; the
live path lets us verify the contract (chain-wide totals, PCR = put/call,
day-over-day OI change, reconstructed 09:15 open) without a database.
"""
import pytest

import app.services.options_lab_service as mod
from app.services.options_lab_service import OptionsLabService


@pytest.fixture
def svc():
    return OptionsLabService(db=None)


def _fake_chain():
    # call_oi = 1000+3000+4000 = 8000 ; call_chg = 200-100+100 = 200
    # put_oi  = 2000+3000      = 5000 ; put_chg  = 500+300     = 800
    return {
        "expiry_date": "2026-07-14",
        "rows": [
            {"strike": 24900.0, "option_type": "CE", "oi": 1000, "oi_change": 200},
            {"strike": 24900.0, "option_type": "PE", "oi": 2000, "oi_change": 500},
            {"strike": 25000.0, "option_type": "CE", "oi": 3000, "oi_change": -100},
            {"strike": 25000.0, "option_type": "PE", "oi": 3000, "oi_change": 300},
            {"strike": 25100.0, "option_type": "CE", "oi": 4000, "oi_change": 100},
        ],
    }


@pytest.fixture(autouse=True)
def _patch_providers(monkeypatch):
    monkeypatch.setattr(mod, "get_option_chain", lambda _id: _fake_chain())
    monkeypatch.setattr(mod, "get_spot", lambda _id: {"last_price": 25000.0})
    monkeypatch.setattr(mod, "get_futures", lambda _id: {"last_price": 25050.0, "source": "fyers"})


def test_live_pcr_series_payload_shape(svc):
    out = svc._live_pcr_series(1)

    for key in ("instrument_id", "symbol", "lot_size", "trade_date", "expiry_date",
                "open_ts", "now_ts", "data_quality", "series"):
        assert key in out, f"missing {key}"

    assert out["data_quality"] == "live_proxy"
    assert out["expiry_date"] == "2026-07-14"
    # Two synthetic points: reconstructed 09:15 open → now.
    assert len(out["series"]) == 2

    now = out["series"][-1]
    assert now["call_oi"] == 8000
    assert now["put_oi"] == 5000
    assert now["call_oi_chg"] == 200
    assert now["put_oi_chg"] == 800
    assert now["pcr"] == pytest.approx(5000 / 8000)      # 0.625
    assert now["fut"] == pytest.approx(25050.0)          # futures overlay, not spot

    # Ascending timestamps.
    assert out["series"][0]["t"] < now["t"]


def test_synth_open_reconstructs_from_oi_change(svc):
    out = svc._live_pcr_series(1)
    opened = out["series"][0]
    # open_oi = now_oi − oi_change
    assert opened["call_oi"] == 8000 - 200   # 7800
    assert opened["put_oi"] == 5000 - 800    # 4200
    assert opened["call_oi_chg"] == 0
    assert opened["put_oi_chg"] == 0
    assert opened["pcr"] == pytest.approx(4200 / 7800, abs=1e-4)  # PCR rounded to 4 dp


def test_synth_pcr_open_null_pcr_when_no_calls(svc):
    now_point = {
        "t": "2026-07-14T05:00:00+00:00", "fut": 100.0,
        "pcr": None, "call_oi": 500, "put_oi": 900,
        "call_oi_chg": 500, "put_oi_chg": 100,
    }
    # call_open = 500 − 500 = 0 → PCR undefined (null, never a divide-by-zero).
    opened = svc._synth_pcr_open(now_point, "2026-07-14T03:45:00+00:00")
    assert opened["call_oi"] == 0
    assert opened["pcr"] is None


def test_live_pcr_series_empty_when_no_rows(svc, monkeypatch):
    monkeypatch.setattr(mod, "get_option_chain", lambda _id: {"rows": []})
    out = svc._live_pcr_series(1)
    assert out["data_quality"] == "empty"
    assert out["series"] == []
    assert out["open_ts"] is None
