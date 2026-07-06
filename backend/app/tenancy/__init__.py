"""
app.tenancy
-----------
Multi-tenant SaaS primitives. M0 introduces only the request-scoped
`TenantContext` plumbing (a contextvar + accessor) so services can start reading
`current_tenant()` without every call signature growing a tenant argument.

The full org/membership/role/permission model, per-tenant tables, and Postgres
Row-Level Security land in M5. Until then a single implicit tenant
(`DEFAULT_TENANT_ID`) is used, so behavior is unchanged.
"""
from app.tenancy.context import (
    DEFAULT_TENANT_ID,
    TenantContext,
    current_tenant,
    set_tenant_context,
    reset_tenant_context,
)
from app.tenancy.org_service import (
    ActiveOrg,
    provision_personal_org,
    create_org,
    is_member,
    list_members,
    resolve_active_org,
    list_user_orgs,
)

__all__ = [
    "DEFAULT_TENANT_ID",
    "TenantContext",
    "current_tenant",
    "set_tenant_context",
    "reset_tenant_context",
    "ActiveOrg",
    "provision_personal_org",
    "create_org",
    "is_member",
    "list_members",
    "resolve_active_org",
    "list_user_orgs",
]
