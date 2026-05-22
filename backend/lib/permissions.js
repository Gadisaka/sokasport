/**
 * Centralized role → permission map.
 *
 * Every route guard references a single permission string (e.g. "tickets:create")
 * rather than scattering role lists. Adding a new role or tweaking access means
 * editing this one file.
 *
 * SUPER_ADMIN and ADMIN receive a wildcard ("*") — they pass every check.
 *
 * @module lib/permissions
 */

export const ROLE_PERMISSIONS = {
  SUPER_ADMIN: new Set(["*"]),
  ADMIN: new Set(["*"]),

  FINANCIAL_SUPPORT: new Set([
    "wallet:approve",
    "wallet:reject",
    "wallet:hold",
    "wallet:pending",
    "wallet:fill",
    "wallet:deduct",
    "wallet:history",
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
    "tickets:create",
    "tickets:read",
    "tickets:cancel",
    "tickets:payout",
    "cashout:execute",
    "wallet:deposit",
    "wallet:withdraw",
    "wallet:history",
    "games:read",
  ]),

  PLAYER: new Set([
    "tickets:create",
    "tickets:read_own",
    "tickets:cashout_own",
    "tickets:cancel_own",
    "wallet:deposit",
    "wallet:withdraw",
    "wallet:history",
  ]),
};

/**
 * Check whether a role has a specific permission.
 * Wildcard ("*") grants everything.
 */
export function roleHasPermission(roleName, permission) {
  const perms = ROLE_PERMISSIONS[roleName];
  if (!perms) return false;
  return perms.has("*") || perms.has(permission);
}
