"""
core/deps.py
------------
FastAPI dependency injectors.
Every route that needs DB or current user imports from here.
"""
from typing import Annotated, AsyncGenerator, Optional

from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal
from app.instruments import InstrumentNotFound, InstrumentRef, resolve_instrument
from app.tenancy import (
    TenantContext,
    reset_tenant_context,
    set_tenant_context,
)

# ── Database ──────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yields an async DB session per request.
    Rolls back on error. Always closes on exit.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Auth ──────────────────────────────────────────────────────
_bearer = HTTPBearer(auto_error=False)


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> int:
    """
    Extracts and validates the JWT access token from Authorization header.
    Returns the user_id (int) on success.
    Raises 401 on missing, expired, or invalid token.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code":    "MISSING_TOKEN",
                "message": "Authorization header required",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code":    "INVALID_TOKEN",
                "message": str(e),
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code":    "INVALID_TOKEN",
                "message": "Token missing subject",
            },
        )

    return int(user_id)


async def get_optional_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Optional[int]:
    """Like get_current_user_id but never raises — returns None when the token
    is missing or invalid. Used to build a TenantContext on routes that don't
    force authentication."""
    if not credentials:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError:
        return None
    sub = payload.get("sub")
    return int(sub) if sub else None


# ── Tenant context (M5: active org + role + permissions + RLS var) ─────────────
async def _optional_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Optional[dict]:
    """Decoded access-token payload, or None (never raises)."""
    if not credentials:
        return None
    try:
        return decode_access_token(credentials.credentials)
    except JWTError:
        return None


async def get_tenant_context(
    db: Annotated[AsyncSession, Depends(get_db)],
    payload: Optional[dict] = Depends(_optional_payload),
) -> AsyncGenerator[TenantContext, None]:
    """Resolve the request's active organization + role + effective permissions,
    bind them into the contextvar, and set the Postgres `app.tenant_id` session
    var (transaction-local) for RLS.

    - Reads `org`/`role` from the token when present; otherwise resolves the
      user's active org from the DB (so pre-M5 tokens still work).
    - Permissions are the grants of the user's role in that org.
    - The RLS var is transaction-local (`set_config(..., true)`) so it never
      leaks across pooled connections. App-layer scoping remains primary; RLS is
      defense-in-depth (and only enforces under a non-superuser DB role).
    """
    from app.tenancy.org_service import resolve_active_org

    ctx = TenantContext()
    if payload is not None:
        sub = payload.get("sub")
        user_id = int(sub) if sub else None
        if user_id is not None:
            preferred = payload.get("org")
            active = await resolve_active_org(db, user_id, preferred_org_id=preferred)
            if active is not None:
                ctx = TenantContext(
                    tenant_id=active.org_id,
                    user_id=user_id,
                    role=active.role,
                    permissions=active.permissions,
                )
                # Transaction-local RLS scope; best-effort (never break a request).
                try:
                    await db.execute(
                        text("SELECT set_config('app.tenant_id', :tid, true)"),
                        {"tid": active.org_id},
                    )
                except Exception:
                    pass
            else:
                ctx = TenantContext(user_id=user_id)

    token = set_tenant_context(ctx)
    try:
        yield ctx
    finally:
        reset_tenant_context(token)


# ── Instrument resolution (M0 plumbing; adopted by routers in M3) ──────────────
async def get_instrument_ref(
    instrument_id: Annotated[int, Path(ge=1)],
    db: AsyncSession = Depends(get_db),
) -> InstrumentRef:
    """Resolve a path `instrument_id` to a validated InstrumentRef, or 404.

    Replaces the hardcoded `Path(ge=1, le=2)` guard with a DB-backed check, so
    any active instrument is accepted and unknown/inactive ids 404 cleanly.
    Routes must name the path param `instrument_id` to use this (M3 renames the
    current `{id}` params).
    """
    try:
        return await resolve_instrument(db, instrument_id)
    except InstrumentNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "INSTRUMENT_NOT_FOUND",
                "message": f"No active instrument with id {instrument_id}",
            },
        )


# ── Authorization (RBAC) ──────────────────────────────────────
def require_permission(permission: str):
    """Dependency factory: 403 unless the active org role grants `permission`.

        @router.post(..., dependencies=[Depends(require_permission("alert.write"))])

    Or capture the context: `ctx: TenantContext = Depends(require_permission("x"))`.
    """
    async def _checker(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if ctx.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "MISSING_TOKEN", "message": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not ctx.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "FORBIDDEN", "message": f"Missing permission: {permission}"},
            )
        return ctx
    return _checker


def require_role(role: str):
    """Dependency factory: 403 unless the active org role equals `role`."""
    async def _checker(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if ctx.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "MISSING_TOKEN", "message": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not ctx.has_role(role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "FORBIDDEN", "message": f"Requires role: {role}"},
            )
        return ctx
    return _checker


# ── Annotated Shortcuts ───────────────────────────────────────
# Use these in route function signatures for clean code:
#
#   async def my_route(db: DBSession, uid: CurrentUserId):
#

DBSession     = Annotated[AsyncSession, Depends(get_db)]
CurrentUserId = Annotated[int, Depends(get_current_user_id)]
OptionalUserId = Annotated[Optional[int], Depends(get_optional_user_id)]
TenantCtx     = Annotated[TenantContext, Depends(get_tenant_context)]
InstrumentRefDep = Annotated[InstrumentRef, Depends(get_instrument_ref)]