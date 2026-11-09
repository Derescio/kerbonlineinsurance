import { randomUUID } from "node:crypto";

import { z } from "zod";

import { logSafeError } from "#/server/auth/errors";
import type { Db } from "#/server/data/job-rows";
import type { Tx } from "#/server/db/tx";
import { EMAIL_TEMPLATE_NAMES, renderEmail, type EmailTemplate } from "#/server/email/registry";

import { enqueue } from "./enqueue";
import { runJob } from "./runner";
import type { HandlerResult, JobDeps, JobRow } from "./types";

// Emails as jobs (4.11, spec calls 5, 7 and 8). Queued with the change that causes them, run
// straight after the response, retried by the cron. An email whose link has expired by the time it
// runs is skipped, not sent late. The job's key goes to Resend, so a job run twice sends once.

export interface EmailJob {
  to: string;
  template: EmailTemplate;
  params?: Record<string, string>;
  /** When the email's link stops working: a retry after this is skipped */
  expiresAt?: Date;
}

const payloadSchema = z.object({
  to: z.string(),
  template: z.enum(EMAIL_TEMPLATE_NAMES),
  params: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime().optional(),
});

/** Queues an email in the caller's transaction (or straight to the database); returns its id */
export async function queueEmail(db: Db | Tx, email: EmailJob, now = new Date()): Promise<number> {
  const id = await enqueue(db, {
    type: "email.send",
    payload: {
      to: email.to,
      template: email.template,
      params: email.params ?? {},
      ...(email.expiresAt ? { expiresAt: email.expiresAt.toISOString() } : {}),
    },
    idempotencyKey: `email:${randomUUID()}`,
    runAfter: now,
  });
  // A fresh random key can't already exist
  return id!;
}

/** Runs a queued job after the response (waitUntil); a failure is left for the cron's retry */
export function runSoon(db: Db, id: number, deps: JobDeps): void {
  // Every job runSoon is given is an email job
  if (deps.holdEmails) return;
  deps.defer(
    runJob(db, id, deps).catch((error: unknown) => {
      console.error("[jobs] run failed:", id, logSafeError(error));
    }),
  );
}

// A function declaration, not a const: handlers.ts imports it while this module may still be
// loading (email.ts → runner.ts → handlers.ts → email.ts), and declarations exist from the start
export async function emailHandler(
  job: JobRow,
  { deps, now }: { deps: JobDeps; now: Date },
): Promise<HandlerResult> {
  const email = payloadSchema.parse(job.payload);
  if (email.expiresAt && new Date(email.expiresAt) <= now) return { skipped: "link expired" };
  await deps.sendEmail(
    { to: email.to, ...renderEmail(email.template, email.params) },
    { idempotencyKey: job.idempotencyKey },
  );
}
