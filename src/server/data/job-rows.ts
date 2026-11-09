import { getDb, type Db } from "#/server/db/client";

export type { Db };
import { jobs } from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

// The jobs table's row helpers behind src/server/jobs/ (4.11). Plain functions, not defineRead:
// jobs belong to no one, and only the runner and the code queuing work call them, so the
// permission suite skips this module.

export type JobRow = typeof jobs.$inferSelect;

/** The app's database, for the jobs' entry points (the cron routes can't reach db/client) */
export function jobsDb(): Db {
  return getDb();
}

/** Inserts a queued job; null when its idempotency key exists already */
export async function insertJob(
  db: Db | Tx,
  job: { type: string; payload: Record<string, unknown>; idempotencyKey: string; runAfter: Date },
): Promise<number | null> {
  const [row] = await db
    .insert(jobs)
    .values(job)
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
}
