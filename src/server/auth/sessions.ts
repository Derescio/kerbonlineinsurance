import { eq } from "drizzle-orm";

import { audit } from "#/server/audit/audit";
import type { AuditKeys } from "#/server/audit/chain";
import { getDb, type Db } from "#/server/db/client";
import { sessions } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { getAuditEnv, getAuthEnv } from "#/server/env";

import type { Actor } from "./actor";
import { recordSecurityEvent } from "./security-events";

// "Sign out everywhere" (4.6, call 11). The sessions delete and its sessions.revoked_all row share
// one transaction, so a failed audit write leaves every session in place (fails closed).
//
// Not Better Auth's /revoke-sessions: that would delete outside our transaction. In 1.7.15 it is
// internalAdapter.deleteUserSessions, which with no secondaryStorage and no session delete hook is
// one delete of the user's rows, so deleting them here does the same. auth-config.test.ts fails if
// either is added; sessions.int.test.ts checks both leave the database the same.

export async function signOutEverywhere(
  db: Db,
  actor: Actor,
  headers?: Headers,
  keys: AuditKeys = getAuditEnv(),
): Promise<{ revoked: number }> {
  // Read first: if the auth environment were broken, nothing changes rather than a committed
  // sign-out reporting an error
  const secret = getAuthEnv().BETTER_AUTH_SECRET;
  const revoked = await withTx(db, async (tx) => {
    const deleted = await tx
      .delete(sessions)
      .where(eq(sessions.userId, actor.userId))
      .returning({ id: sessions.id });
    await audit(
      tx,
      {
        actor,
        action: "sessions.revoked_all",
        entityId: actor.userId,
        changes: { revoked: deleted.length },
      },
      keys,
    );
    return deleted.length;
  });

  // After the commit, so a rolled-back sign-out records nothing. Best-effort, as every event is
  await recordSecurityEvent(db, secret, {
    type: "signed_out_everywhere",
    userId: actor.userId,
    headers,
  });
  return { revoked };
}

/** For the server function: the app's database and keys (features can't import the database) */
export function signOutEverywhereNow(actor: Actor, headers?: Headers) {
  return signOutEverywhere(getDb(), actor, headers);
}
