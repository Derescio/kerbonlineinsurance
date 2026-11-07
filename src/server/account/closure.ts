import { z } from "zod";

import { rejected, type WriteResult } from "#/lib/validation";
import { audit } from "#/server/audit/audit";
import { getAuth, type Auth } from "#/server/auth/auth";
import { requireUser, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import {
  cancelClosureRow,
  deleteOtherSessions,
  getAccountState,
  hasRecordsOnFile,
  hasStaffRow,
  insertClosure,
  lockOpenClosure,
  lockUser,
  recordsOnFile,
  userEmail,
} from "#/server/data";
import { defineWrite, type WriteEnvelope } from "#/server/data/define";
import { closureCancelledEmail, closureRequestedEmail } from "#/server/email/templates";

import { proveIdentity } from "./confirm";
import { CLOSE_RULE } from "./delete";
import { accountDeps, formatClosureDate, sendLater, type AccountDeps } from "./emails";

// Requesting and cancelling a closure (4.7 decisions 2-3, calls 11, 12, 16). Both go through
// defineWrite, so a double click acts once and each has its own limit. Request proves identity
// before its transaction (ruling R2), in defineWrite's `before` step: after the limit, so every
// attempt is counted, a wrong password included (auth.api calls skip Better Auth's own rate
// limiter), and after the replay lookup, so a replay is neither counted nor proved again. Cancel
// is one click with no proof.
//
// defineWrite is built per call so `run` can carry this request's session id in, and say whether
// it ran: a replayed key doesn't run it, and its email isn't sent twice. Its input schema is
// empty on purpose: the payload's hash is stored with the key, and an unsalted hash of a password
// mustn't be.

export const ALREADY_CLOSING = "Your account is already closing.";
export const NOTHING_ON_FILE =
  "You have no insurance records, so your account can be deleted straight away instead.";

const noInput = z.object({});

export async function requestClosure(
  actor: Actor | null,
  envelope: WriteEnvelope,
  ctx: { headers: Headers },
  deps: AccountDeps = accountDeps(),
  auth: Auth = getAuth(),
): Promise<WriteResult<{ closesAt: string }>> {
  const known = requireUser(actor);

  // The session to keep: the one making the request, set by the proof
  let keepSessionId = "";

  const done: { email?: string; closesAt?: Date } = {};
  const write = defineWrite(
    noInput,
    {
      limit: { action: "account.close", rule: CLOSE_RULE },
      idempotent: { action: "account.close" },
      before: async (actor, raw, ctx) => {
        const proof = await proveIdentity(actor, raw?.input, ctx.headers, auth);
        if (!proof.ok) return proof.error;
        keepSessionId = proof.sessionId;
        return null;
      },
    },
    async (actor, _input, tx) => {
      const userId = actor.userId;
      // Serialises two requests (with different keys) for the same user
      const user = await lockUser(tx, userId, "write");
      if (!user) throw new AuthzError("UNAUTHENTICATED");
      const state = await getAccountState(tx, userId);
      if (state.kind === "closed") throw new AuthzError("ACCOUNT_CLOSED");
      if (await hasStaffRow(tx, userId)) throw new AuthzError("STAFF_ACCOUNT");
      if (state.kind === "closure_requested") return rejected(ALREADY_CLOSING);
      if (!hasRecordsOnFile(await recordsOnFile(tx, userId))) return rejected(NOTHING_ON_FILE);

      const closure = await insertClosure(tx, userId);
      const closesAt = closure.closesAt.toISOString();
      await audit(tx, {
        actor,
        action: "account.closure_requested",
        entityId: userId,
        changes: { closesAt },
      });
      // Only the sessions that exist now; a sign-in during the window keeps its session
      await deleteOtherSessions(tx, userId, keepSessionId);
      done.email = user.email;
      done.closesAt = closure.closesAt;
      return { closesAt };
    },
  );

  const result = await write(known, envelope, ctx);
  if (result.ok && done.email && done.closesAt) {
    sendLater(
      deps,
      done.email,
      closureRequestedEmail({ closesOn: formatClosureDate(done.closesAt) }),
    );
  }
  return result;
}

export async function cancelClosure(
  actor: Actor | null,
  envelope: WriteEnvelope,
  ctx: { headers: Headers },
  deps: AccountDeps = accountDeps(),
): Promise<WriteResult<{ kept: true }>> {
  const done: { email?: string } = {};
  const write = defineWrite(
    noInput,
    {
      limit: { action: "account.keep", rule: CLOSE_RULE },
      idempotent: { action: "account.keep" },
    },
    async (actor, _input, tx) => {
      const userId = actor.userId;
      // The daily job locks the same row, so exactly one of the two wins
      const open = await lockOpenClosure(tx, userId);
      if (!open) {
        const state = await getAccountState(tx, userId);
        throw new AuthzError(state.kind === "closed" ? "ACCOUNT_CLOSED" : "CLOSURE_NOT_OPEN");
      }
      await cancelClosureRow(tx, open.id);
      await audit(tx, { actor, action: "account.closure_cancelled", entityId: userId });
      done.email = (await userEmail(tx, userId)) ?? undefined;
      return { kept: true as const };
    },
  );

  const result = await write(actor, envelope, ctx);
  if (result.ok && done.email) sendLater(deps, done.email, closureCancelledEmail());
  return result;
}
