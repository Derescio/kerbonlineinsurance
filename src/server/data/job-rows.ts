import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { getDb, type Db } from "#/server/db/client";
import { MAX_ATTEMPTS } from "#/server/jobs/backoff";

export type { Db };
import { idempotencyKeys, jobs, rateLimits } from "#/server/db/schema";
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

const claimed = (now: Date) => ({
  status: "running" as const,
  attempts: sql`${jobs.attempts} + 1`,
  updatedAt: now,
});

/** Takes one job by id, only while it's queued and due: the waitUntil run straight after a request */
export async function claimJobById(db: Db, id: number, now: Date): Promise<JobRow | null> {
  const [row] = await db
    .update(jobs)
    .set(claimed(now))
    .where(and(eq(jobs.id, id), eq(jobs.status, "queued"), lte(jobs.runAfter, now)))
    .returning();
  return row ?? null;
}

/**
 * Takes the next due job: queued or failed with its time come, or running but not updated since
 * `staleBefore` (its function died) with attempts left. SKIP LOCKED, so two runners never take the
 * same row. The attempts guard holds even when no runner has marked the stale job dead yet.
 */
export async function claimNextJob(
  db: Db,
  now: Date,
  staleBefore: Date,
  skipTypes: string[] = [],
): Promise<JobRow | null> {
  const skip = skipTypes.length > 0 ? sql`and type not in ${skipTypes}` : sql``;
  const [row] = await db
    .update(jobs)
    .set(claimed(now))
    .where(
      eq(
        jobs.id,
        sql`(select id from jobs
             where ((status in ('queued', 'failed') and run_after <= ${now})
                or (status = 'running' and updated_at < ${staleBefore}
                    and attempts < ${MAX_ATTEMPTS}))
               ${skip}
             order by run_after, id
             limit 1
             for update skip locked)`,
      ),
    )
    .returning();
  return row ?? null;
}

/** How many email jobs are waiting to be sent: queued, or failed with a retry to come */
export async function countWaitingEmails(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, "email.send"), inArray(jobs.status, ["queued", "failed"])));
  return row?.n ?? 0;
}

/** Running jobs that died with their function after their last attempt: dead, never run again */
export async function markStaleJobsDead(
  db: Db,
  now: Date,
  staleBefore: Date,
  maxAttempts: number,
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "dead", lastError: "timed out", updatedAt: now })
    .where(
      and(
        eq(jobs.status, "running"),
        lt(jobs.updatedAt, staleBefore),
        gte(jobs.attempts, maxAttempts),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/**
 * Records how an attempt ended, at `at`. A finished job's payload is emptied (spec call 9). `at`
 * must differ from the claim's `updated_at`: the jobs_set_updated_at trigger (0002) replaces an
 * unchanged value with the database clock
 */
export async function finishJob(
  db: Db,
  id: number,
  at: Date,
  outcome:
    | { status: "done"; lastError: string | null }
    | { status: "failed"; lastError: string; runAfter: Date }
    | { status: "dead"; lastError: string },
): Promise<void> {
  await db
    .update(jobs)
    .set({ ...outcome, ...(outcome.status === "done" ? { payload: {} } : {}), updatedAt: at })
    .where(eq(jobs.id, id));
}

const DAY_MS = 24 * 60 * 60_000;

export interface ExpiredRows {
  idempotencyKeys: number;
  rateLimits: number;
  doneJobs: number;
  deadJobs: number;
}

/**
 * The daily housekeeping (4.5c call 20, 4.11 call 13): expired idempotency keys, rate-limit windows
 * over a day old (the longest window is an hour), done jobs after 7 days and dead jobs after 30.
 */
export async function deleteExpiredRows(db: Db, now: Date): Promise<ExpiredRows> {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const ids = { id: jobs.id };
  const [keys, windows, done, dead] = await Promise.all([
    db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, now))
      .returning({ key: idempotencyKeys.key }),
    db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, before(1)))
      .returning({ key: rateLimits.key }),
    db
      .delete(jobs)
      .where(and(eq(jobs.status, "done"), lt(jobs.updatedAt, before(7))))
      .returning(ids),
    db
      .delete(jobs)
      .where(and(eq(jobs.status, "dead"), lt(jobs.updatedAt, before(30))))
      .returning(ids),
  ]);
  return {
    idempotencyKeys: keys.length,
    rateLimits: windows.length,
    doneJobs: done.length,
    deadJobs: dead.length,
  };
}
