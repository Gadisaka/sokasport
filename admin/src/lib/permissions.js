/**
 * Client-side mirror of backend ROLE_PERMISSIONS — used to conditionally
 * render navigation items and action buttons. The backend is the real
 * enforcement layer; this just prevents showing UI the user can't act on.
 */

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: new Set(["*"]),

  ADMIN: new Set([
    "dashboard:read",
    "users:read",
    "users:create",
    "users:update",
    "agents-cashiers:read",
    "games:read",
    "games:write",
    "tickets:read",
    "tickets:void",
    "wallets:read",
    "wallets:approve",
    "reports:read",
    "cms:read",
    "cms:write",
    "settings:read",
    "settings:write",
    "audit-log:read",
    "devices:pending",
    "devices:read",
    "devices:approve",
    "devices:reject",
    "devices:revoke",
  ]),

  FINANCIAL_SUPPORT: new Set([
    "dashboard:read",
    "wallets:read",
    "wallets:approve",
    "reports:read",
  ]),

  AGENT: new Set([
    "dashboard:read",
    "cashiers:read",
    "reports:read",
    "tickets:read",
    "games:read",
  ]),

  CASHIER: new Set([
    "dashboard:read",
    "tickets:read",
    "tickets:create",
    "games:read",
    "wallets:read",
    "settings:read",
  ]),
};

export function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.has("*") || perms.has(permission);
}

/** Roles that should never appear in the "create user" form. */
export const HIDDEN_ROLES_FOR_CREATE = ["PLAYER"];

/** Roles that only SUPER_ADMIN can assign. */
export const SUPER_ADMIN_ONLY_ROLES = ["SUPER_ADMIN"];
