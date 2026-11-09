import { audit } from "#/server/audit/audit";
import { logSafeError } from "#/server/auth/errors";
import {
  closeAccountRows,
  closeClosureRow,
  dueClosures,
  holdClosureRow,
  lockDueClosure,
  lockUser,
  openClaimReference,
  type Db,
} from "#/server/data/account";
import { withTx } from "#/server/db/tx";
import { queueEmail, runSoon } from "#/server/jobs/email";

import type { AccountDeps } from "./emails";

// The daily closure job (4.7 call 14), run as the `account.closures` job (4.11) by the daily cron
// and `vp run jobs:daily`.
// Every open closure whose window has ended by `now` is held (an open claim) or closed (call 9),
// each in its own transaction, so one failure doesn't stop the rest.
//
// Lock order: the users row first (FOR UPDATE), then the closure row (SKIP LOCKED). A cancel
// takes them in the same order (its idempotency key row takes a KEY SHARE on the user, then it
// locks the closure), so the two queue rather than deadlock: whichever commits first wins, the
// job then skips a cancelled row, and a late cancel finds the account closed (ACCOUNT_CLOSED).
// The users row needs FOR UPDATE anyway: closing changes its unique email.

export interface ClosureRunResult {
  closed: number;
  held: number;
  failed: number;
}

type Outcome =
  | { kind: "skipped" }
  | { kind: "held"; emailJob: number }
  | { kind: "closed"; emailJob: number };

async function processClosure(db: Db, closureId: string, userId: string): Promise<Outcome> {
  return withTx(db, async (tx): Promise<Outcome> => {
    const user = await lockUser(tx, userId, "delete");
    if (!user) return { kind: "skipped" };
    const closure = await lockDueClosure(tx, closureId);
    if (!closure) return { kind: "skipped" };

    const claimReference = await openClaimReference(tx, userId);
    if (claimReference) {
      // Held already: check again tomorrow, without a new audit row or email
      if (closure.heldSince) return { kind: "skipped" };
      const reason = `claim_open:${claimReference}`;
      await holdClosureRow(tx, closure.id, reason);
      await audit(tx, {
        actor: null,
        action: "account.closure_held",
        entityId: userId,
        changes: { reason },
      });
      const emailJob = await queueEmail(tx, {
        to: user.email,
        template: "closure_held",
        params: { claimReference },
      });
      return { kind: "held", emailJob };
    }

    await closeAccountRows(tx, userId);
    const { retainUntil } = await closeClosureRow(tx, closure.id);
    await audit(tx, {
      actor: null,
      action: "account.closed",
      entityId: userId,
      changes: {
        ...(closure.heldSince ? { heldSince: closure.heldSince.toISOString() } : {}),
        retainUntil: retainUntil.toISOString(),
      },
    });
    // The original address, read under the lock before the scrub replaced it
    const emailJob = await queueEmail(tx, { to: user.email, template: "account_closed" });
    return { kind: "closed", emailJob };
  });
}

export async function runClosures(db: Db, now: Date, deps: AccountDeps): Promise<ClosureRunResult> {
  const result: ClosureRunResult = { closed: 0, held: 0, failed: 0 };
  for (const { id, userId } of await dueClosures(db, now)) {
    let outcome: Outcome;
    try {
      outcome = await processClosure(db, id, userId);
    } catch (error) {
      result.failed++;
      // The closure's id and the error's class only: never the email
      console.error("[account] closure failed:", id, logSafeError(error));
      continue;
    }
    if (outcome.kind === "skipped") continue;
    result[outcome.kind]++;
    // After the commit, as every account email is sent
    runSoon(db, outcome.emailJob, deps);
  }
  return result;
}
