import { runClosures } from "#/server/account/run-closures";
import { accountDb } from "#/server/data/account";
import { deleteExpiredRows, type Db } from "#/server/data/job-rows";
import { uploadsDb } from "#/server/data/file-rows";
import { withTx } from "#/server/db/tx";
import { runUploadsCleanup } from "#/server/uploads/cleanup";
import { getObjectStore } from "#/server/uploads/store";

import { dayKey } from "./backoff";
import { enqueue } from "./enqueue";
import type { HandlerResult, JobDeps, JobRow, JobType } from "./types";

// The daily jobs (4.11, spec calls 6 and 13). The daily cron queues them, once per UTC day by
// their keys, and the runner takes them in this order: closures before the cleanup (a closure
// marks files for it), the anchor last (it records the day's final audit row). Every one is safe
// to run twice: each works from the rows as they are, and the anchor checks for today's first.

export const DAILY_JOBS = [
  "account.closures",
  "uploads.cleanup",
  "housekeeping.expired_rows",
  "audit.anchor",
] as const satisfies readonly JobType[];

/** Queues today's jobs; returns how many were new (0 when today's are already queued) */
export async function queueDailyJobs(db: Db, now: Date): Promise<number> {
  return withTx(db, async (tx) => {
    let queued = 0;
    // One at a time, so the ids, and so the run order, follow DAILY_JOBS
    for (const type of DAILY_JOBS) {
      const id = await enqueue(tx, {
        type,
        payload: {},
        idempotencyKey: `${type}:${dayKey(now)}`,
        runAfter: now,
      });
      if (id !== null) queued++;
    }
    return queued;
  });
}

// Function declarations, as in email.ts: handlers.ts reads them through an import cycle

/** Throws when any closure failed, so the job is retried; the ones that went through are done */
export async function closuresHandler(
  _job: JobRow,
  { now, deps }: { now: Date; deps: JobDeps },
): Promise<HandlerResult> {
  const result = await runClosures(accountDb(), now, deps);
  if (result.failed > 0) throw new Error(`${result.failed} closures failed`);
}

/** Throws when any file's objects couldn't be deleted, so the job is retried */
export async function cleanupHandler(_job: JobRow, { now }: { now: Date }): Promise<HandlerResult> {
  const result = await runUploadsCleanup(uploadsDb(), getObjectStore(), now);
  if (result.failed > 0) throw new Error(`${result.failed} files not purged`);
}

export async function housekeepingHandler(
  _job: JobRow,
  { db, now }: { db: Db; now: Date },
): Promise<HandlerResult> {
  await deleteExpiredRows(db, now);
}
