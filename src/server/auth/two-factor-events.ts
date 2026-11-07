import { and, eq } from "drizzle-orm";
import { APIError } from "better-auth/api";

import { audit } from "#/server/audit/audit";
import type { Db } from "#/server/db/client";
import { sessions } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { getAuditEnv } from "#/server/env";

import { resolveActor } from "./actor";
import { logSafeError } from "./errors";
import type { SecurityEventInput } from "./security-events";

// What kerbTwoFactor() writes after a signed-in 2FA change or a password change (4.6,
// plan/phases/04-data-auth/06-two-factor.md calls 10 and 11). Split from two-factor.ts for size;
// the hooks that call these live there.

/**
 * The before hook on /two-factor/disable (call 10). The audit row can only be written after Better
 * Auth's change, so keys that can't be parsed refuse the request before anything changes
 */
export function assertAuditKeys(): void {
  try {
    getAuditEnv();
  } catch (error) {
    console.error("[audit] keys unusable, two-factor disable refused:", logSafeError(error));
    throw new APIError("INTERNAL_SERVER_ERROR", {
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
  }
}

/**
 * The audit row for turning two-factor off (call 10). Better Auth's write has already committed,
 * so this can't share its transaction: assertAuditKeys() has ruled out bad keys, and a failure here
 * (the database, between the two writes) is logged by name while the response stands
 */
export async function auditTwoFactorDisabled(db: Db, userId: string): Promise<void> {
  try {
    const actor = await resolveActor(db, userId);
    await withTx(db, (tx) => audit(tx, { actor, action: "two_factor.disabled", entityId: userId }));
  } catch (error) {
    console.error("[audit] two_factor.disabled not written:", logSafeError(error));
  }
}

export interface PasswordChange {
  /** `ctx.context.newSession`'s id: the one session Better Auth left */
  newSessionId: string | undefined;
  userId: string;
  /** The old session's two_factor_verified_at (ISO), handed over by the before hook */
  carryStamp: string | undefined;
  headers: Headers | undefined;
}

/**
 * After a password change (call 11). Better Auth has deleted every one of the user's sessions and
 * made a new one, because the before hook forced `revokeOtherSessions`. The old session's stamp
 * carries over, so a staff member isn't asked for a code straight away. A failed copy leaves the
 * new session unstamped, which only means a code is asked for, so it's logged and the response
 * stands
 */
export async function afterPasswordChange(
  db: Db,
  record: (event: SecurityEventInput) => Promise<void>,
  { newSessionId, userId, carryStamp, headers }: PasswordChange,
): Promise<void> {
  if (!newSessionId) {
    // Can't happen while revokeOtherSessions is forced: nothing was revoked, so nothing recorded
    console.error("[auth] password changed without a new session");
    return;
  }
  const stampAt = carryStamp ? new Date(carryStamp) : null;
  if (stampAt && !Number.isNaN(stampAt.getTime())) {
    try {
      await db
        .update(sessions)
        .set({ twoFactorVerifiedAt: stampAt })
        .where(and(eq(sessions.id, newSessionId), eq(sessions.userId, userId)));
    } catch (error) {
      console.error("[auth] two-factor stamp not carried over:", logSafeError(error));
    }
  }
  await record({ type: "sessions_revoked_on_password_change", userId, headers });
}
