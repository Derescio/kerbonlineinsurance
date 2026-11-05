import type { StaffRole } from "#/server/db/schema/values";

// What staff can do (plan/phases/04-data-auth/05-authorization.md). Code checks these names, never a role.
export const PERMISSIONS = [
  "claims.read_all",
  "claims.update",
  "referrals.read",
  "referrals.decide",
  "reviews.moderate",
  "staff.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// The only place roles are mapped to permissions.
// admin is listed in full, not as "everything", so a permission added later is never granted to admins unchosen.
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  claims_handler: ["claims.read_all", "claims.update", "referrals.read", "referrals.decide"],
  admin: [
    "claims.read_all",
    "claims.update",
    "referrals.read",
    "referrals.decide",
    "reviews.moderate",
    "staff.manage",
    "audit.read",
  ],
};

/** Unknown role strings grant nothing, so a role removed from the code but left in the database is harmless */
export function permissionsFor(roles: readonly string[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (!Object.hasOwn(ROLE_PERMISSIONS, role)) continue;
    for (const permission of ROLE_PERMISSIONS[role as StaffRole]) granted.add(permission);
  }
  return granted;
}
