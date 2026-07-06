"""
app.market_data
---------------
Broker-agnostic Market Data Service — the single facade the application calls
for quotes, option chains, futures, OI, and history. It resolves the right
`BrokerAdapter` from `app.brokers.registry` and returns normalized data, so no
router/service above it knows or cares which broker supplied it.

M2 introduces the facade alongside the legacy `app.ingestion.providers.*`
functions (which still power the live request path). M3 rewires the routers and
services onto this facade and deletes the providers' remaining hardcoding.
"""
from app.market_data.service import MarketDataService, market_data

__all__ = ["MarketDataService", "market_data"]
