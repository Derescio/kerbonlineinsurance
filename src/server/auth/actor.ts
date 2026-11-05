import { eq } from "drizzle-orm";

import { AuthzError } from "./errors";
import { permissionsFor, type Permission } from "./permissions";

import type { Db } from "#/server/db/client";
import { users } from "#/server/db/schema";

// Who is asking (4.5). Every protected read starts from an Actor and checks a permission, never a role.

export interface Actor {
  userId: string;
  customerId: string | null;
  /** Set for active staff, even one with no roles left (they are staff but can do nothing) */
  staff: {
    displayName: string;
    roles: readonly string[];
    permissions: ReadonlySet<Permission>;
  } | null;
}

/** One query: the user with their customer row, and their staff row (if not deactivated) and its roles */
export async function resolveActor(db: Db, userId: string): Promise<Actor | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
    with: {
      customer: { columns: { id: true } },
      staffMember: {
        columns: { displayName: true, deactivatedAt: true },
        with: { roles: { columns: { role: true } } },
      },
    },
  });
  if (!user) return null;

  const member =
    user.staffMember && user.staffMember.deactivatedAt === null ? user.staffMember : null;
  const roles = member ? member.roles.map((row) => row.role) : [];
  return {
    userId: user.id,
    customerId: user.customer?.id ?? null,
    staff: member
      ? { displayName: member.displayName, roles, permissions: permissionsFor(roles) }
      : null,
  };
}

/** The actor behind a request's session cookie, read fresh from the database; null if signed out */
export async function getActor(headers: Headers): Promise<Actor | null> {
  // Imported here so the pure helpers below load without env validation, as in features/auth/session.ts
  const [{ getAuth }, { getDb }] = await Promise.all([
    import("#/server/auth/auth"),
    import("#/server/db/client"),
  ]);
  const session = await getAuth().api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) return null;
  return resolveActor(getDb(), session.user.id);
}

export function requireUser(actor: Actor | null): Actor {
  if (!actor) throw new AuthzError("UNAUTHENTICATED");
  return actor;
}

export function requirePermission(actor: Actor | null, permission: Permission): Actor {
  const known = requireUser(actor);
  if (!known.staff?.permissions.has(permission)) throw new AuthzError("FORBIDDEN");
  return known;
}

/** Staff can't work on their own policy, claim or quote */
export function assertNoConflict(actor: Actor, ownerCustomerId: string): void {
  if (actor.customerId !== null && actor.customerId === ownerCustomerId) {
    throw new AuthzError("CONFLICT_OF_INTEREST");
  }
}
