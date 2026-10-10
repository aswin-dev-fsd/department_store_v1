// Who may do what (overview §3 → Permission matrix; D-04). Routes and screens check a
// permission such as 'bill:create', never a role name, so adding a role (e.g. Owner, FP-03)
// is one entry in ROLE_PERMISSIONS plus a seed row — no code changes elsewhere.

/** Every action a role can be granted. */
export const PERMISSIONS = [
  'bill:create',
  'bill:read',
  'bill:cancel',
  'purchase:write',
  'purchase:post',
  'purchase:cancel',
  'item:write',
  'category:write',
  'vendor:write',
  'stock:read',
  'stock:adjust',
  'report:own-day-summary',
  'report:all',
  'admin:branches',
  'admin:users',
  'admin:settings',
  'admin:import',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Must match the database `user_role` enum (checked by a backend test). */
export const ROLES = ['admin', 'cashier'] as const;

export type Role = (typeof ROLES)[number];

/** The role → permission map. Frozen, so nothing can grant extra rights at runtime. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  // Counter staff: everything needed to run a branch day to day (own branch only)
  cashier: Object.freeze<Permission[]>([
    'bill:create',
    'bill:read',
    'bill:cancel',
    'purchase:write',
    'purchase:post',
    'purchase:cancel',
    'item:write',
    'category:write',
    'vendor:write',
    'stock:read',
    'stock:adjust',
    'report:own-day-summary',
  ]),
  // Setup and oversight across all branches; does not bill
  admin: Object.freeze<Permission[]>([
    'stock:read',
    'report:all',
    'admin:branches',
    'admin:users',
    'admin:settings',
    'admin:import',
  ]),
});

/** Whether `role` may perform `permission`. Unknown roles get nothing. */
export function can(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}
