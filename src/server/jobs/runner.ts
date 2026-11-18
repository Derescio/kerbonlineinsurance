import { logSafeError } from "#/server/auth/errors";
import {
  claimJobById,
  claimNextJob,
  finishJob,
  markStaleJobsDead,
  type Db,
  type JobRow,
} from "#/server/data/job-rows";

import { MAX_ATTEMPTS, nextRunAfter, STALE_AFTER_MS } from "./backoff";
import { HANDLERS } from "./handlers";
import type { Handler, JobDeps, JobType } from "./types";

// The jobs runner (4.11, spec call 10). runJob takes one job straight after the request that
// queued it (waitUntil); runDueJobs is the cron's loop. Both claim a row with one atomic UPDATE,
// so a job is never run by two at once. A throw fails only that job: `failed` with a retry time,
// or `dead` after 5 attempts, its error recorded by class name (and SQLSTATE) only.

export type Handlers = Partial<Record<JobType, Handler>>;

/** How an attempt ended */
export type Outcome = "done" | "failed" | "dead";

export interface RunCounts {
  ran: number;
  done: number;
  failed: number;
  dead: number;
}

/** "Error" or "DatabaseError (23505)": never a message, which can carry an address or a key */
function safeError(error: unknown): string {
  const { name, pgCode } = logSafeError(error);
  return pgCode ? `${name} (${pgCode})` : name;
}

async function execute(
  db: Db,
  job: JobRow,
  deps: JobDeps,
  now: Date,
  handlers: Handlers,
): Promise<Outcome> {
  // The run's clock moved on by however long the job took (at least 1 ms, so the claim's stamp
  // changes and the database's own clock doesn't replace it; see finishJob)
  const startedAt = Date.now();
  const finishedAt = () => new Date(now.getTime() + Math.max(1, Date.now() - startedAt));
  try {
    // Own keys only: a type such as "constructor" mustn't find an Object.prototype method
    const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type as JobType] : undefined;
    if (!handler) throw new Error("No handler for job type");
    const result = await handler(job, { db, deps, now });
    const lastError = result ? `skipped: ${result.skipped}` : null;
    await finishJob(db, job.id, finishedAt(), { status: "done", lastError });
    return "done";
  } catch (error) {
    const lastError = safeError(error);
    console.error("[jobs] failed:", job.id, job.type, lastError);
    const runAfter = nextRunAfter(job.attempts, now);
    if (!runAfter) {
      await finishJob(db, job.id, finishedAt(), { status: "dead", lastError });
      return "dead";
    }
    await finishJob(db, job.id, finishedAt(), { status: "failed", lastError, runAfter });
    return "failed";
  }
}

/** Runs one job if it's still queued and due; null when it wasn't (already taken, or not due) */
export async function runJob(
  db: Db,
  id: number,
  deps: JobDeps,
  now = new Date(),
  handlers: Handlers = HANDLERS,
): Promise<Outcome | null> {
  const job = await claimJobById(db, id, now);
  return job ? execute(db, job, deps, now, handlers) : null;
}

/** Runs due jobs one at a time, up to `max`, starting none after `budgetMs` of wall-clock time */
export async function runDueJobs(
  db: Db,
  deps: JobDeps,
  now: Date,
  opts: { max?: number; budgetMs?: number; handlers?: Handlers } = {},
): Promise<RunCounts> {
  const { max = 50, budgetMs = 45_000, handlers = HANDLERS } = opts;
  const startedAt = Date.now();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const counts: RunCounts = { ran: 0, done: 0, failed: 0, dead: 0 };
  counts.dead += await markStaleJobsDead(db, now, staleBefore, MAX_ATTEMPTS);

  while (counts.ran < max && Date.now() - startedAt < budgetMs) {
    const job = await claimNextJob(db, now, staleBefore, deps.holdEmails ? ["email.send"] : []);
    if (!job) break;
    counts.ran++;
    counts[await execute(db, job, deps, now, handlers)]++;
  }
  return counts;
}
