"""
app/brokers/connections.py
--------------------------
Durable, encrypted storage for broker access/refresh tokens — the replacement
for the single global in-memory + .env Fyers token (app/core/token_store.py).

- Tokens are encrypted at rest with Fernet. The key comes from
  settings.BROKER_TOKEN_ENC_KEY, or is derived deterministically from
  SECRET_KEY when that is unset (fine for single-node dev).
- `user_id=None` denotes the implicit single-user/global connection (the Fyers
  OAuth callback is unauthenticated, so it has no user to attach to yet). M5
  makes connections per-user/tenant.

Hot-path note: `token_store` remains the fast, sync, in-memory source the Fyers
provider reads on each call. These async DB helpers persist the token durably
and reload it into `token_store` on startup — so a restart no longer depends on
the .env value.
"""
from __future__ import annotations

import base64
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import BrokerConnection

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Encryption
# ─────────────────────────────────────────────────────────────

def _fernet():
    from cryptography.fernet import Fernet

    key = settings.BROKER_TOKEN_ENC_KEY.strip()
    if not key:
        # Derive a valid 32-byte urlsafe-base64 Fernet key from SECRET_KEY so no
        # extra env var is required in dev. Deterministic → survives restarts.
        digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest).decode("ascii")
    return Fernet(key.encode("ascii") if isinstance(key, str) else key)


def encrypt(plaintext: Optional[str]) -> Optional[str]:
    if not plaintext:
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: Optional[str]) -> Optional[str]:
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except Exception:
        # Wrong/rotated key or corrupt value — treat as "no token" rather than
        # crashing the request; the user simply re-authenticates.
        logger.warning("broker token decrypt failed — treating as unset", exc_info=True)
        return None


# ─────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────

async def _find(db: AsyncSession, broker: str, user_id: Optional[int]) -> Optional[BrokerConnection]:
    stmt = select(BrokerConnection).where(BrokerConnection.broker == broker)
    stmt = stmt.where(
        BrokerConnection.user_id == user_id if user_id is not None
        else BrokerConnection.user_id.is_(None)
    )
    return (await db.execute(stmt.order_by(BrokerConnection.updated_at.desc()))).scalars().first()


async def save_broker_token(
    db: AsyncSession,
    broker: str,
    access_token: str,
    *,
    user_id: Optional[int] = None,
    refresh_token: Optional[str] = None,
    meta: Optional[dict] = None,
    expires_at: Optional[datetime] = None,
) -> BrokerConnection:
    """Upsert the (user_id, broker) connection with an encrypted token. Caller commits."""
    row = await _find(db, broker, user_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = BrokerConnection(broker=broker, user_id=user_id)
        db.add(row)
    row.access_token_enc = encrypt(access_token)
    row.refresh_token_enc = encrypt(refresh_token)
    if meta is not None:
        row.meta = meta
    row.status = "ACTIVE"
    row.generated_at = now
    row.expires_at = expires_at
    await db.flush()
    logger.info("saved %s broker token for user_id=%s", broker, user_id)
    return row


async def get_broker_token(
    db: AsyncSession, broker: str, *, user_id: Optional[int] = None
) -> Optional[str]:
    """Return the decrypted access token for a connection, or None."""
    row = await _find(db, broker, user_id)
    if row is None or row.status != "ACTIVE":
        return None
    return decrypt(row.access_token_enc)


async def revoke_broker_token(
    db: AsyncSession, broker: str, *, user_id: Optional[int] = None
) -> None:
    """Mark a connection revoked and wipe its ciphertext. Caller commits."""
    row = await _find(db, broker, user_id)
    if row is not None:
        row.access_token_enc = None
        row.refresh_token_enc = None
        row.status = "REVOKED"
        await db.flush()


# ─────────────────────────────────────────────────────────────
# Bridge to the sync hot-path token store
# ─────────────────────────────────────────────────────────────

async def load_fyers_token_into_store(db: AsyncSession) -> bool:
    """On startup: hydrate the in-memory token_store from the durable DB token.

    Precedence: DB (persisted via OAuth) → falls back to the .env value already
    loaded into token_store. Returns True if a DB token was loaded.
    """
    token = await get_broker_token(db, "fyers", user_id=None)
    if token:
        # Import here to avoid a cycle at module load.
        from app.core import token_store
        token_store.set_in_memory(token)
        logger.info("Fyers token loaded from broker_connections into token_store")
        return True
    return False
