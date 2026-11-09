import type { Db, JobRow } from "#/server/data/job-rows";
import type { jobStatuses } from "#/server/db/schema/values";
import type { SendEmail } from "#/server/email/send";

// The shapes the jobs runner and its handlers share (4.11).

export type JobType =
  | "email.send"
  | "account.closures"
  | "uploads.cleanup"
  | "housekeeping.expired_rows"
  | "audit.anchor";

export type { JobRow };
export type JobStatus = (typeof jobStatuses)[number];

export interface JobDeps {
  sendEmail: SendEmail;
  /** Keeps work alive after the response (Vercel's waitUntil); tests await it themselves */
  defer: (work: Promise<unknown>) => void;
}

/** A skip ends the job `done`, with the reason in `last_error` (e.g. a link that has expired) */
export type HandlerResult = void | { skipped: string };

/** Throws to fail the attempt; must be safe to run twice (engineering.md §11) */
export type Handler = (
  job: JobRow,
  ctx: { db: Db; deps: JobDeps; now: Date },
) => Promise<HandlerResult>;
