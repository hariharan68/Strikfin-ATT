"""
app.brokers
-----------
Broker Adapter layer — the abstraction that lets StrikeFin talk to any broker /
data vendor through one identical interface. The rest of the app calls the
Market Data Service (app.market_data), which resolves a `BrokerAdapter` from the
registry; nothing above this package knows whether the data came from Fyers,
the mock provider, or (later) Zerodha/Angel/Dhan/Upstox.

M2 introduces the read surface (quotes, option chain, futures, history). Trading
methods (orders/positions/holdings) are declared on the base for later phases.
"""
from app.brokers.base import BrokerAdapter, BrokerError

__all__ = ["BrokerAdapter", "BrokerError"]
