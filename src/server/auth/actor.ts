import { eq } from "drizzle-orm";

import { AuthzError } from "./errors";
import { permissionsFor, type Permission } from "./permissions";
import { STAFF_FRESH_MS } from "./two-factor-constants";

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
  /** `enabled` is the account's setting; `verifiedAt` is when this session last gave a code */
  twoFactor: { enabled: boolean; verifiedAt: Date | null };
}

/**
 * One query: the user with their customer row, their staff row and its roles. The staff row is
 * dropped in JS after the fetch if `deactivated_at` is set at all, even to a future date.
 */
export async function resolveActor(
  db: Db,
  userId: string,
  session?: { twoFactorVerifiedAt: Date | null },
): Promise<Actor | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, twoFactorEnabled: true },
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
    twoFactor: { enabled: user.twoFactorEnabled, verifiedAt: session?.twoFactorVerifiedAt ?? null },
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
  return resolveActor(getDb(), session.user.id, {
    twoFactorVerifiedAt: session.session.twoFactorVerifiedAt ?? null,
  });
}

export function requireUser(actor: Actor | null): Actor {
  if (!actor) throw new AuthzError("UNAUTHENTICATED");
  // 2FA is on but this session hasn't given a code yet
  if (actor.twoFactor.enabled && actor.twoFactor.verifiedAt === null) {
    throw new AuthzError("TWO_FACTOR_CHALLENGE");
  }
  return actor;
}

export function requirePermission(actor: Actor | null, permission: Permission): Actor {
  const known = requireUser(actor);
  if (known.staff && !known.twoFactor.enabled) throw new AuthzError("TWO_FACTOR_REQUIRED");
  if (!known.staff?.permissions.has(permission)) throw new AuthzError("FORBIDDEN");
  return known;
}

/** For sensitive actions: the session must have given a code within the last two hours */
export function requireFresh(actor: Actor, now = new Date()): Actor {
  const { verifiedAt } = actor.twoFactor;
  if (verifiedAt === null || now.getTime() - verifiedAt.getTime() > STAFF_FRESH_MS) {
    throw new AuthzError("SESSION_NOT_FRESH");
  }
  return actor;
}

/** Staff can't work on their own policy, claim or quote */
export function assertNoConflict(actor: Actor, ownerCustomerId: string): void {
  if (actor.customerId !== null && actor.customerId === ownerCustomerId) {
    throw new AuthzError("CONFLICT_OF_INTEREST");
  }
}
