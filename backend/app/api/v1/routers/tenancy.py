"""
api/v1/routers/tenancy.py
-------------------------
Multi-tenant SaaS endpoints (M5): organizations, members, API keys, and the
current user's tenancy context.

    GET    /api/v1/me/tenancy            — active org, role, permissions, my orgs
    GET    /api/v1/orgs                  — orgs I belong to
    POST   /api/v1/orgs                  — create a team org (I become owner)
    GET    /api/v1/orgs/{org_id}/members — members of an org I belong to
    GET    /api/v1/api-keys              — active org's API keys (apikey.manage)
    POST   /api/v1/api-keys              — create a key, returned once (apikey.manage)
    DELETE /api/v1/api-keys/{key_id}     — revoke a key (apikey.manage)
"""
from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel

from app.core.deps import CurrentUserId, DBSession, TenantCtx, require_permission
from app.tenancy import (
    create_org,
    is_member,
    list_members,
    list_user_orgs,
)
from app.tenancy.api_key_service import create_api_key, list_api_keys, revoke_api_key

router = APIRouter(tags=["tenancy"])


# ── Schemas ───────────────────────────────────────────────────
class CreateOrgRequest(BaseModel):
    name: str


class CreateApiKeyRequest(BaseModel):
    name: str
    scopes: list[str] | None = None


# ── Me / tenancy ──────────────────────────────────────────────
@router.get("/me/tenancy")
async def my_tenancy(db: DBSession, ctx: TenantCtx, uid: CurrentUserId):
    """The caller's active org, role, effective permissions, and all their orgs."""
    return {
        "user_id": uid,
        "active_org_id": ctx.tenant_id if ctx.user_id else None,
        "role": ctx.role,
        "permissions": sorted(ctx.permissions),
        "orgs": await list_user_orgs(db, uid),
    }


# ── Organizations ─────────────────────────────────────────────
@router.get("/orgs")
async def my_orgs(db: DBSession, uid: CurrentUserId):
    return await list_user_orgs(db, uid)


@router.post("/orgs", status_code=status.HTTP_201_CREATED)
async def create_organization(body: CreateOrgRequest, db: DBSession, uid: CurrentUserId):
    org = await create_org(db, uid, body.name, is_personal=False)
    await db.commit()
    return {"org_id": str(org.id), "name": org.name, "slug": org.slug, "role": "owner"}


@router.get("/orgs/{org_id}/members")
async def org_members(
    db: DBSession,
    uid: CurrentUserId,
    org_id: str = Path(...),
):
    if not await is_member(db, org_id, uid):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Not a member of this organization"},
        )
    return await list_members(db, org_id)


# ── API keys (active org; require apikey.manage) ──────────────
@router.get("/api-keys")
async def api_keys(db: DBSession, ctx=Depends(require_permission("apikey.manage"))):
    rows = await list_api_keys(db, ctx.tenant_id)
    return [
        {
            "id": str(k.id),
            "name": k.name,
            "key_prefix": k.key_prefix,
            "scopes": k.scopes,
            "last_used_at": k.last_used_at,
            "revoked": k.revoked_at is not None,
            "created_at": k.created_at,
        }
        for k in rows
    ]


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
async def create_key(
    body: CreateApiKeyRequest,
    db: DBSession,
    ctx=Depends(require_permission("apikey.manage")),
):
    row, raw = await create_api_key(
        db, ctx.tenant_id, body.name, created_by=ctx.user_id, scopes=body.scopes
    )
    await db.commit()
    # The raw key is returned exactly once — it cannot be recovered later.
    return {"id": str(row.id), "name": row.name, "api_key": raw, "key_prefix": row.key_prefix}


@router.delete("/api-keys/{key_id}")
async def delete_key(
    db: DBSession,
    key_id: str = Path(...),
    ctx=Depends(require_permission("apikey.manage")),
):
    ok = await revoke_api_key(db, ctx.tenant_id, key_id)
    await db.commit()
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "API key not found or already revoked"},
        )
    return {"revoked": True}
