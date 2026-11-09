import { insertJob, type Db } from "#/server/data/job-rows";
import type { Tx } from "#/server/db/tx";

import type { JobType } from "./types";

// The outbox (4.11, spec call 8): called with the caller's transaction, so a job is never lost and
// never queued for a change that rolled back. The unique key makes a second enqueue a no-op.

export function enqueue(
  db: Db | Tx,
  job: { type: JobType; payload: Record<string, unknown>; idempotencyKey: string; runAfter: Date },
): Promise<number | null> {
  return insertJob(db, job);
}
