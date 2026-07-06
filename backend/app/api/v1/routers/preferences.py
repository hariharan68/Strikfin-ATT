"""
api/v1/routers/preferences.py
------------------------------
Per-user Settings-page state: UI preferences + current plan (read-only).

    GET  /api/v1/me/preferences   — the caller's UI preferences (defaults if none)
    PUT  /api/v1/me/preferences   — partial upsert of preferences
    GET  /api/v1/me/plan          — the caller's active-org plan (name/price/limits)
"""
from fastapi import APIRouter

from app.core.deps import CurrentUserId, DBSession
from app.core.exceptions import AppError, to_http_exception
from app.domain.schemas import PlanOut, PreferencesOut, PreferencesUpdate
from app.services.preferences_service import (
    get_current_plan,
    get_preferences,
    upsert_preferences,
)

router = APIRouter(tags=["preferences"])


@router.get("/me/preferences", response_model=PreferencesOut)
async def read_preferences(db: DBSession, uid: CurrentUserId):
    try:
        return await get_preferences(db, uid)
    except AppError as e:
        raise to_http_exception(e)


@router.put("/me/preferences", response_model=PreferencesOut)
async def write_preferences(body: PreferencesUpdate, db: DBSession, uid: CurrentUserId):
    try:
        return await upsert_preferences(db, uid, body)
    except AppError as e:
        raise to_http_exception(e)


@router.get("/me/plan", response_model=PlanOut)
async def read_plan(db: DBSession, uid: CurrentUserId):
    try:
        return await get_current_plan(db, uid)
    except AppError as e:
        raise to_http_exception(e)
