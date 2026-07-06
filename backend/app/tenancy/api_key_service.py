"""
app/tenancy/api_key_service.py
------------------------------
Per-organization API keys for the public REST/SDK plane.

Only the SHA-256 hash of a key is stored; the raw key is shown exactly once at
creation. Keys carry optional scopes and are org-scoped.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ApiKey

_PREFIX = "sk_live_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def create_api_key(
    db: AsyncSession,
    org_id: str,
    name: str,
    *,
    created_by: Optional[int] = None,
    scopes: Optional[list[str]] = None,
) -> tuple[ApiKey, str]:
    """Create a key. Returns (row, raw_key). The raw key is only returned here —
    it cannot be recovered later. Caller commits."""
    raw = _PREFIX + secrets.token_urlsafe(32)
    row = ApiKey(
        org_id=org_id,
        name=name,
        key_prefix=raw[: len(_PREFIX) + 6],  # e.g. sk_live_a1b2c3
        key_hash=_hash(raw),
        scopes=scopes or [],
        created_by=created_by,
    )
    db.add(row)
    await db.flush()
    return row, raw


async def list_api_keys(db: AsyncSession, org_id: str) -> list[ApiKey]:
    rows = (
        await db.execute(
            select(ApiKey).where(ApiKey.org_id == org_id).order_by(ApiKey.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


async def revoke_api_key(db: AsyncSession, org_id: str, key_id: str) -> bool:
    row = (
        await db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.org_id == org_id)
        )
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return True


async def authenticate_api_key(db: AsyncSession, raw_key: str) -> Optional[ApiKey]:
    """Resolve a raw API key to its active row (records last_used). Caller commits."""
    row = (
        await db.execute(
            select(ApiKey).where(ApiKey.key_hash == _hash(raw_key), ApiKey.revoked_at.is_(None))
        )
    ).scalar_one_or_none()
    if row is not None:
        row.last_used_at = datetime.now(timezone.utc)
    return row
