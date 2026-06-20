"""
core/deps.py
------------
FastAPI dependency injectors.
Every route that needs DB or current user imports from here.
"""
from typing import Annotated, AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal

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


# ── Annotated Shortcuts ───────────────────────────────────────
# Use these in route function signatures for clean code:
#
#   async def my_route(db: DBSession, uid: CurrentUserId):
#

DBSession     = Annotated[AsyncSession, Depends(get_db)]
CurrentUserId = Annotated[int, Depends(get_current_user_id)]