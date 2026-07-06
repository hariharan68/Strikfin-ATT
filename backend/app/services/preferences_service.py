"""
services/preferences_service.py
-------------------------------
Per-user UI preferences (Settings page) + current-plan read.
Router calls service. Service calls DB.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Organization, Plan, Subscription, UserPreference
from app.domain.schemas import PlanOut, PreferencesOut, PreferencesUpdate
from app.tenancy.org_service import resolve_active_org


# ── Preferences ───────────────────────────────────────────────
async def get_preferences(db: AsyncSession, user_id: int) -> PreferencesOut:
    """Current user's preferences, or schema defaults if no row yet."""
    row = await db.get(UserPreference, user_id)
    if row is None:
        return PreferencesOut()
    return PreferencesOut.model_validate(row)


async def upsert_preferences(
    db: AsyncSession, user_id: int, body: PreferencesUpdate
) -> PreferencesOut:
    """Insert-or-update the user's preferences; only provided fields are applied."""
    changes = body.model_dump(exclude_unset=True)
    row = await db.get(UserPreference, user_id)
    if row is None:
        row = UserPreference(user_id=user_id, **changes)
        db.add(row)
    else:
        for field, value in changes.items():
            setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return PreferencesOut.model_validate(row)


# ── Current plan ──────────────────────────────────────────────
async def get_current_plan(db: AsyncSession, user_id: int) -> PlanOut:
    """The user's active-org plan (name/price/limits from the seeded `plans`
    table) plus a renewal date if a Subscription row exists (none today)."""
    active = await resolve_active_org(db, user_id)

    plan_key = "free"
    org_id = None
    if active is not None:
        org_id = active.org_id
        org = await db.get(Organization, active.org_id)
        if org is not None:
            plan_key = org.plan_key

    plan = (
        await db.execute(select(Plan).where(Plan.key == plan_key))
    ).scalar_one_or_none()

    # Optional subscription (renewal date / status) — empty in practice today.
    renewal_date = None
    status = "active"
    if org_id is not None:
        sub = (
            await db.execute(
                select(Subscription)
                .where(Subscription.org_id == org_id)
                .order_by(Subscription.created_at.desc())
            )
        ).scalars().first()
        if sub is not None:
            renewal_date = sub.current_period_end
            status = sub.status.lower()

    if plan is None:
        # Defensive fallback if the plans table isn't seeded.
        return PlanOut(
            key=plan_key, name=plan_key.title(), price_inr=0, limits={},
            renewal_date=renewal_date, status=status,
        )

    return PlanOut(
        key=plan.key,
        name=plan.name,
        price_inr=plan.price_inr,
        limits=plan.limits or {},
        renewal_date=renewal_date,
        status=status,
    )
