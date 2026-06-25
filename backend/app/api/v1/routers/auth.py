"""
api/v1/routers/auth.py
----------------------
Auth endpoints. All public except /me.
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
"""
from fastapi import APIRouter, Depends, Request, status

from app.core.deps import DBSession, CurrentUserId
from app.core.rate_limit import login_rate_limit
from app.core.exceptions import to_http_exception, AppError
from app.domain.schemas import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Register ──────────────────────────────────────────────────
@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(login_rate_limit)],
)
async def register(
    body: RegisterRequest,
    request: Request,
    db: DBSession,
):
    try:
        svc = AuthService(db)
        return await svc.register(
            body=body,
            ip=request.client.host if request.client else None,
        )
    except AppError as e:
        raise to_http_exception(e)


# ── Login ─────────────────────────────────────────────────────
@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(login_rate_limit)],
)
async def login(
    body: LoginRequest,
    request: Request,
    db: DBSession,
):
    try:
        svc = AuthService(db)
        return await svc.login(
            email=body.email,
            password=body.password,
            ip=request.client.host if request.client else None,
            device_info=request.headers.get("user-agent", "")[:300],
        )
    except AppError as e:
        raise to_http_exception(e)


# ── Refresh ───────────────────────────────────────────────────
@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    db: DBSession,
):
    try:
        svc = AuthService(db)
        return await svc.refresh(body.refresh_token)
    except AppError as e:
        raise to_http_exception(e)


# ── Logout ────────────────────────────────────────────────────
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: LogoutRequest,
    request: Request,
    db: DBSession,
    current_user_id: CurrentUserId,
):
    try:
        svc = AuthService(db)
        await svc.logout(
            raw_refresh_token=body.refresh_token,
            user_id=current_user_id,
            ip=request.client.host if request.client else None,
        )
    except AppError as e:
        raise to_http_exception(e)


# ── Me ────────────────────────────────────────────────────────
@router.get("/me", response_model=UserOut)
async def me(
    db: DBSession,
    current_user_id: CurrentUserId,
):
    try:
        svc = AuthService(db)
        return await svc.get_me(current_user_id)
    except AppError as e:
        raise to_http_exception(e)