"""
core/security.py
----------------
Password hashing and JWT token creation/verification.
Pure functions — no DB, no network access.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# ── Password Hashing ──────────────────────────────────────────
# Use the `bcrypt` library directly. (passlib is unmaintained and
# breaks against bcrypt >= 4.1, which removed `bcrypt.__about__`.)
# bcrypt only considers the first 72 bytes of a password, and bcrypt
# >= 5.0 raises if given more, so we truncate to 72 bytes explicitly.


def _to_bcrypt_bytes(plain: str) -> bytes:
    return plain.encode("utf-8")[:72]


def hash_password(plain: str) -> str:
    hashed = bcrypt.hashpw(_to_bcrypt_bytes(plain), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bcrypt_bytes(plain), hashed.encode("utf-8"))
    except ValueError:
        # malformed/empty stored hash
        return False


# ── Access Token ──────────────────────────────────────────────
def create_access_token(user_id: int) -> str:
    """
    Creates a short-lived JWT access token.
    Expires in ACCESS_TOKEN_EXPIRE_MINUTES (default 60).
    """
    expires = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {
        "sub":  str(user_id),
        "exp":  expires,
        "type": "access",
    }
    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    """
    Decodes and validates a JWT access token.
    Raises JWTError if expired, tampered, or wrong type.
    """
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
    )
    if payload.get("type") != "access":
        raise JWTError("Not an access token")
    return payload


# ── Refresh Token ─────────────────────────────────────────────
def create_refresh_token() -> tuple[str, datetime]:
    """
    Creates a long-lived refresh token.
    Returns (raw_token, expires_at).
    Store only the HASH in DB — never the raw token.
    """
    raw = secrets.token_urlsafe(64)
    expires = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    return raw, expires


def hash_token(raw: str) -> str:
    """
    SHA-256 hash of a raw refresh token.
    This is what gets stored in the DB.
    """
    return hashlib.sha256(raw.encode()).hexdigest()