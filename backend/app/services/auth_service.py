"""
services/auth_service.py
------------------------
All authentication business logic lives here.
Router calls service. Service calls DB. Never the other way.
"""
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, ConflictError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.core.config import settings
from app.db.models import AuditLog, RefreshToken, User
from app.domain.schemas import RegisterRequest, TokenResponse, UserOut


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Register ──────────────────────────────────────────────
    async def register(
        self,
        body: RegisterRequest,
        ip: str | None = None,
    ) -> UserOut:
        """
        Creates a new user account.
        Raises ConflictError if email already exists.
        """
        # Check duplicate email
        result = await self.db.execute(
            select(User).where(User.email == body.email)
        )
        if result.scalar_one_or_none():
            raise ConflictError("Email already registered")

        # Create user
        user = User(
            email=body.email,
            password_hash=hash_password(body.password),
            display_name=body.display_name,
        )
        self.db.add(user)
        await self.db.flush()  # get user_id before audit log

        # Audit
        self.db.add(AuditLog(
            user_id=user.user_id,
            action="REGISTER",
            ip=ip,
            detail=json.dumps({"email": body.email}),
        ))

        await self.db.commit()
        await self.db.refresh(user)
        return UserOut.model_validate(user)

    # ── Login ─────────────────────────────────────────────────
    async def login(
        self,
        email: str,
        password: str,
        ip: str | None = None,
        device_info: str | None = None,
    ) -> dict:
        """
        Validates credentials.
        Returns access token + refresh token on success.
        Raises AuthenticationError on bad credentials.
        """
        # Find user
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()

        # Same error for wrong email or wrong password
        # — prevents email enumeration attacks
        if not user or not verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid email or password")

        if not user.is_active:
            raise AuthenticationError("Account is disabled")

        # Issue tokens
        access_token = create_access_token(user.user_id)
        raw_refresh, expires_at = create_refresh_token()

        # Store hashed refresh token
        self.db.add(RefreshToken(
            user_id=user.user_id,
            token_hash=hash_token(raw_refresh),
            expires_at=expires_at,
            device_info=device_info,
        ))

        # Update last login
        user.last_login_at = datetime.now(timezone.utc)

        # Audit
        self.db.add(AuditLog(
            user_id=user.user_id,
            action="LOGIN",
            ip=ip,
        ))

        await self.db.commit()

        return {
            "access_token":  access_token,
            "refresh_token": raw_refresh,
            "token_type":    "bearer",
            "expires_in":    settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    # ── Refresh ───────────────────────────────────────────────
    async def refresh(self, raw_refresh_token: str) -> dict:
        """
        Validates refresh token, revokes it, issues a new pair.
        Raises AuthenticationError if token is invalid/expired/revoked.
        """
        token_hash = hash_token(raw_refresh_token)
        now = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at == None,   # noqa: E711
                RefreshToken.expires_at > now,
            )
        )
        stored = result.scalar_one_or_none()

        if not stored:
            raise AuthenticationError("Refresh token invalid or expired")

        # Revoke old token
        stored.revoked_at = now

        # Issue new pair
        new_access = create_access_token(stored.user_id)
        raw_new_refresh, expires_at = create_refresh_token()

        self.db.add(RefreshToken(
            user_id=stored.user_id,
            token_hash=hash_token(raw_new_refresh),
            expires_at=expires_at,
        ))

        await self.db.commit()

        return {
            "access_token":  new_access,
            "refresh_token": raw_new_refresh,
            "token_type":    "bearer",
            "expires_in":    settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    # ── Logout ────────────────────────────────────────────────
    async def logout(
        self,
        raw_refresh_token: str,
        user_id: int,
        ip: str | None = None,
    ) -> None:
        """
        Revokes the refresh token.
        Silent success even if token not found (idempotent).
        """
        token_hash = hash_token(raw_refresh_token)

        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at == None,   # noqa: E711
            )
        )
        stored = result.scalar_one_or_none()

        if stored:
            stored.revoked_at = datetime.now(timezone.utc)

        # Audit
        self.db.add(AuditLog(
            user_id=user_id,
            action="LOGOUT",
            ip=ip,
        ))

        await self.db.commit()

    # ── Me ────────────────────────────────────────────────────
    async def get_me(self, user_id: int) -> UserOut:
        """Returns current user profile."""
        result = await self.db.execute(
            select(User).where(User.user_id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            from app.core.exceptions import NotFoundError
            raise NotFoundError("User")
        return UserOut.model_validate(user)