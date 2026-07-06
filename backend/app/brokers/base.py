"""
app/brokers/base.py
-------------------
`BrokerAdapter` — the abstract interface every broker/data-vendor implements.

Design contract
---------------
- Every method takes an `InstrumentRef` (never a bare int or a vendor symbol
  string). The adapter is responsible for translating the ref into its own
  vendor symbol via `ref.vendor_symbol("<vendor>")` / `ref.vendor_symbols`.
- Read methods return **plain dicts** whose shape matches what the existing
  `ingestion.providers` functions already return (last_price/open/high/…,
  option chain rows, etc.). Keeping the dict contract means the Market Data
  Service and its consumers don't change shape when M3 rewires them off the old
  `providers.*` calls. A future pass can introduce typed DTOs behind the same
  interface without touching callers.
- Methods are **synchronous** because the underlying vendor SDKs (Fyers v3) are
  sync and manage their own threaded TTL cache. The async Market Data Service
  calls them via a threadpool so it never blocks the event loop.

Adding a broker = subclass this, implement the read methods (translate the ref,
call the vendor SDK, normalize to the dict shape), and register it in
`app.brokers.registry`.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from app.instruments import InstrumentRef


class BrokerError(Exception):
    """Raised by an adapter when a vendor call fails unrecoverably. Callers may
    catch this to fall back (e.g. to a mock adapter) or surface a 502."""


class BrokerAdapter(ABC):
    """One broker / market-data vendor behind a uniform interface."""

    #: short vendor key, e.g. "fyers", "mock", "zerodha". Used by the registry
    #: and to look up symbols in `InstrumentRef.vendor_symbols[name]`.
    name: str = "base"

    #: True if this adapter can place/track orders (Phase: trading). Read-only
    #: data vendors leave this False.
    supports_trading: bool = False

    # ── Market data (read) — required ────────────────────────────────────────
    @abstractmethod
    def get_spot(self, ref: InstrumentRef) -> dict:
        """Latest spot/quote for the instrument (LTP, OHLC, prev_close, …)."""

    @abstractmethod
    def get_option_chain(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        """Option chain (strikes with CE/PE OI, LTP, IV, greeks, …)."""

    @abstractmethod
    def get_futures(self, ref: InstrumentRef) -> dict:
        """Current-month futures quote for the instrument."""

    @abstractmethod
    def get_history(self, ref: InstrumentRef, days: int = 60, resolution: str = "D") -> dict:
        """Historical candles for the instrument."""

    # ── Open interest — default derives from the option chain ────────────────
    def get_open_interest(self, ref: InstrumentRef, expiry_date: Optional[str] = None) -> dict:
        """Aggregate OI view. Default implementation pulls it from the option
        chain (total call/put OI + PCR) so adapters without a dedicated OI feed
        still satisfy the interface; override for a native OI endpoint."""
        chain = self.get_option_chain(ref, expiry_date)
        rows = chain.get("rows") or chain.get("chain") or []
        call_oi = sum((r.get("oi") or 0) for r in rows if r.get("option_type") == "CE")
        put_oi = sum((r.get("oi") or 0) for r in rows if r.get("option_type") == "PE")
        pcr = (put_oi / call_oi) if call_oi else None
        return {
            "instrument_id": ref.instrument_id,
            "total_call_oi": call_oi,
            "total_put_oi": put_oi,
            "pcr_oi": pcr,
            "source": chain.get("source"),
        }

    # ── Connection health — optional ─────────────────────────────────────────
    def is_connected(self) -> bool:
        """Whether the adapter can currently reach its vendor. Data vendors that
        need no auth return True."""
        return True

    # ── Trading (orders/positions/holdings) — later phases ───────────────────
    # Declared here so the interface is complete; unsupported adapters raise.
    def get_positions(self, *args, **kwargs) -> list:
        raise NotImplementedError(f"{self.name} adapter does not support trading")

    def get_orders(self, *args, **kwargs) -> list:
        raise NotImplementedError(f"{self.name} adapter does not support trading")

    def get_holdings(self, *args, **kwargs) -> list:
        raise NotImplementedError(f"{self.name} adapter does not support trading")

    def place_order(self, *args, **kwargs) -> dict:
        raise NotImplementedError(f"{self.name} adapter does not support trading")
