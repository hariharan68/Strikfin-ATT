"""
app/tenancy/org_service.py
--------------------------
Organization + membership + role/permission resolution — the core of the
multi-tenant model.

- Every user gets a **personal organization** (they are its owner) on register;
  existing users are provisioned lazily on their next login.
- A user's access is the union of the permissions granted to their role in the
  **active** organization.

App-layer scoping (queries filtered by user_id / org membership) is the primary
tenant isolation today; Postgres RLS is deploy-ready defense-in-depth (see the
migration + notes).
"""
from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Membership, Organization, Permission, Role, RolePermission, User

logger = logging.getLogger(__name__)

_OWNER_ROLE = "owner"


@dataclass(frozen=True)
class ActiveOrg:
    """The resolved active organization for a user, with their effective role
    and permission set."""
    org_id: str
    org_name: str
    role: str
    permissions: frozenset[str]


def _slugify(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "org"
    return f"{base[:120]}-{secrets.token_hex(3)}"


async def _role_by_key(db: AsyncSession, key: str) -> Role:
    role = (await db.execute(select(Role).where(Role.key == key))).scalar_one_or_none()
    if role is None:
        raise RuntimeError(f"Role '{key}' not seeded — run migrations")
    return role


async def _permissions_for_role(db: AsyncSession, role_id) -> frozenset[str]:
    rows = (
        await db.execute(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
        )
    ).scalars().all()
    return frozenset(rows)


async def provision_personal_org(db: AsyncSession, user: User) -> Organization:
    """Create a user's personal org + owner membership if they have none.
    Idempotent: returns the existing personal org when already provisioned.
    Caller commits."""
    existing = (
        await db.execute(
            select(Organization)
            .join(Membership, Membership.org_id == Organization.id)
            .where(Membership.user_id == user.user_id)
            .order_by(Organization.created_at)
        )
    ).scalars().first()
    if existing is not None:
        return existing

    name = (user.display_name or user.email.split("@")[0] or "My").strip()
    org = Organization(
        name=f"{name}'s Workspace",
        slug=_slugify(name),
        owner_user_id=user.user_id,
        plan_key="free",
        is_personal=True,
    )
    db.add(org)
    await db.flush()

    owner_role = await _role_by_key(db, _OWNER_ROLE)
    db.add(Membership(org_id=org.id, user_id=user.user_id, role_id=owner_role.id, status="ACTIVE"))
    await db.flush()
    logger.info("provisioned personal org %s for user %s", org.id, user.user_id)
    return org


async def create_org(
    db: AsyncSession, owner_user_id: int, name: str, *, is_personal: bool = False
) -> Organization:
    """Create a team/personal org with the creator as owner. Caller commits."""
    org = Organization(
        name=name.strip() or "Workspace",
        slug=_slugify(name),
        owner_user_id=owner_user_id,
        plan_key="free",
        is_personal=is_personal,
    )
    db.add(org)
    await db.flush()
    owner_role = await _role_by_key(db, _OWNER_ROLE)
    db.add(Membership(org_id=org.id, user_id=owner_user_id, role_id=owner_role.id, status="ACTIVE"))
    await db.flush()
    return org


async def is_member(db: AsyncSession, org_id: str, user_id: int) -> bool:
    row = (
        await db.execute(
            select(Membership.id).where(
                Membership.org_id == org_id, Membership.user_id == user_id, Membership.status == "ACTIVE"
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def list_members(db: AsyncSession, org_id: str) -> list[dict]:
    stmt = (
        select(User.user_id, User.email, User.display_name, Role.key)
        .join(Membership, Membership.user_id == User.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.org_id == org_id, Membership.status == "ACTIVE")
        .order_by(User.user_id)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {"user_id": uid, "email": email, "display_name": dn, "role": role}
        for uid, email, dn, role in rows
    ]


async def resolve_active_org(
    db: AsyncSession, user_id: int, preferred_org_id: Optional[str] = None
) -> Optional[ActiveOrg]:
    """Resolve the user's active org (preferred if a member, else their first),
    with role + effective permissions. Returns None if the user has no org yet."""
    stmt = (
        select(Organization, Role)
        .join(Membership, Membership.org_id == Organization.id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.user_id == user_id, Membership.status == "ACTIVE")
        .order_by(Organization.created_at)
    )
    rows = (await db.execute(stmt)).all()
    if not rows:
        return None

    chosen = None
    if preferred_org_id:
        chosen = next((r for r in rows if str(r[0].id) == str(preferred_org_id)), None)
    if chosen is None:
        chosen = rows[0]

    org, role = chosen
    perms = await _permissions_for_role(db, role.id)
    return ActiveOrg(org_id=str(org.id), org_name=org.name, role=role.key, permissions=perms)


async def list_user_orgs(db: AsyncSession, user_id: int) -> list[dict]:
    """All orgs the user belongs to, with their role — for GET /orgs and /me."""
    stmt = (
        select(Organization, Role)
        .join(Membership, Membership.org_id == Organization.id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.user_id == user_id, Membership.status == "ACTIVE")
        .order_by(Organization.created_at)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "org_id": str(org.id),
            "name": org.name,
            "slug": org.slug,
            "plan_key": org.plan_key,
            "is_personal": org.is_personal,
            "role": role.key,
        }
        for org, role in rows
    ]
