import { rejected, Rejected, type WriteResult } from "#/lib/validation";
import { audit } from "#/server/audit/audit";
import { getAuth, type Auth } from "#/server/auth/auth";
import { requireUser, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import {
  accountDb,
  deleteUserRow,
  hasAnyClosure,
  hasRecordsOnFile,
  hasStaffRow,
  lockUser,
  recordsOnFile,
  withAccountTx,
} from "#/server/data/account";
import type { WriteEnvelope } from "#/server/data/define";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";
import { queueEmail, runSoon } from "#/server/jobs/email";

import { proveIdentity } from "./confirm";
import { CLOSE_LIMIT } from "./constants";
import { accountDeps, type AccountDeps } from "./emails";
import { filesHook } from "./files";

// The immediate delete, for an account with nothing on file (4.7 decision 2, call 17). Not
// defineWrite: its idempotency key would live in idempotency_keys, which cascades from users, so
// the delete would remove its own key (call 12). The users row is locked FOR UPDATE instead, so
// a second request waits, then finds the user gone and gets UNAUTHENTICATED.

export const INSURANCE_RECORDS =
  "You have insurance records, so your account will be closed instead.";

export const CLOSE_RULE = { max: CLOSE_LIMIT.max, windowSeconds: CLOSE_LIMIT.window };

export async function deleteAccount(
  actor: Actor | null,
  envelope: WriteEnvelope,
  ctx: { headers: Headers },
  deps: AccountDeps = accountDeps(),
  auth: Auth = getAuth(),
): Promise<WriteResult<{ deleted: true }>> {
  const known = requireUser(actor);
  // Before the proof, so every attempt counts, a wrong password included: auth.api calls skip
  // Better Auth's own rate limiter, so without this the password check would be unthrottled
  await limit(`account.delete:${await rateLimitSubject(known, ctx.headers)}`, CLOSE_RULE);
  const proof = await proveIdentity(known, envelope?.input, ctx.headers, auth);
  if (!proof.ok) return proof;

  const userId = known.userId;
  const result = await withAccountTx(async (tx) => {
    const user = await lockUser(tx, userId, "delete");
    // Deleted by a request that committed while this one waited on the lock
    if (!user) throw new AuthzError("UNAUTHENTICATED");
    if (await hasStaffRow(tx, userId)) throw new AuthzError("STAFF_ACCOUNT");
    // Any closure row, even a cancelled one, means the closure path (ruling R3)
    if ((await hasAnyClosure(tx, userId)) || hasRecordsOnFile(await recordsOnFile(tx, userId))) {
      return rejected(INSURANCE_RECORDS);
    }
    await audit(tx, { actor: known, action: "account.deleted", entityId: userId });
    const fileKeys = await filesHook.deleteUserFiles(tx, userId);
    await deleteUserRow(tx, userId);
    // To the address read before the delete; a job has no link to the user, so it outlives them
    const emailJob = await queueEmail(tx, { to: user.email, template: "account_deleted" });
    return { emailJob, fileKeys };
  });
  if (result instanceof Rejected) return { ok: false, error: result.error };

  // After the commit
  runSoon(accountDb(), result.emailJob, deps);
  // After the commit too, so a rollback never leaves rows pointing at missing objects
  if (result.fileKeys.length > 0) deps.defer(filesHook.purgeObjects(result.fileKeys));
  return { ok: true, data: { deleted: true } };
}

/**
 * After a delete the browser still holds the session cookie and the 5-minute session-data cookie
 * cache. Better Auth's own sign-out expires both (and, run through the server function, the
 * tanstackStartCookies plugin forwards them). Returns the headers so a test can see the cookies.
 */
export async function clearSessionCookies(
  headers: Headers,
  auth: Auth = getAuth(),
): Promise<Headers> {
  const { headers: out } = await auth.api.signOut({ headers, returnHeaders: true });
  return out;
}
