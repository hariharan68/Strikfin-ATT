"""
app/tenancy/context.py
----------------------
Request-scoped tenant identity, carried in a `contextvar` so it is available to
any layer (services, repositories) without threading a `tenant_id` argument
through every function.

M0: single implicit tenant (DEFAULT_TENANT_ID). The FastAPI dependency in
core/deps.py sets a context from the authenticated user; unauthenticated/system
paths (the ingestion scheduler) run under the default tenant. Behavior is
unchanged versus today's single-user app.

M5: `TenantContext` gains a real organization id resolved from the JWT/active
org, and `set_tenant_context` additionally issues `SET app.tenant_id = :id` on
the DB session so Postgres Row-Level Security enforces isolation.
"""
from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Optional

# Sentinel tenant used while the app is still single-tenant (pre-M5).
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000"


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Who is making the current request, for isolation + auditing.

    `tenant_id` is the active organization id (scopes tenant-plane data + RLS).
    `role` is the user's role in that org; `permissions` is the effective grant
    set backing authorization checks. Market/instrument data is global and
    ignores this.
    """

    tenant_id: str = DEFAULT_TENANT_ID
    user_id: Optional[int] = None
    role: Optional[str] = None
    permissions: frozenset[str] = field(default_factory=frozenset)

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions

    def has_role(self, role: str) -> bool:
        return self.role == role


# The default context represents the implicit single tenant / anonymous system
# work (e.g. the background scheduler) until M5 wires real orgs.
_DEFAULT_CONTEXT = TenantContext()

_tenant_ctx: ContextVar[TenantContext] = ContextVar(
    "strikfin_tenant_ctx", default=_DEFAULT_CONTEXT
)


def current_tenant() -> TenantContext:
    """The active request's TenantContext (or the default outside a request)."""
    return _tenant_ctx.get()


def set_tenant_context(ctx: TenantContext) -> Token[TenantContext]:
    """Bind `ctx` for the current async task; returns a token to reset with.

    Use via the FastAPI dependency (core/deps.py) which resets on request exit,
    or manually with try/finally + `reset_tenant_context`.
    """
    return _tenant_ctx.set(ctx)


def reset_tenant_context(token: Token[TenantContext]) -> None:
    """Restore the context that preceded a `set_tenant_context` call."""
    _tenant_ctx.reset(token)
