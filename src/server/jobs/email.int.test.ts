import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { jobs } from "#/server/db/schema";
import type { EmailMessage } from "#/server/email/send";
import { truncateAll } from "#/test/db";

import { queueEmail, runSoon } from "./email";
import { runDueJobs, runJob } from "./runner";
import type { JobDeps } from "./types";

// Emails as jobs (4.11, spec calls 5 and 7): sent once per key, skipped once their link has
// expired, and a failure never records the address.

const now = new Date("2026-11-09T10:00:00Z");
const HOUR = 60 * 60_000;
const TO = "maya.patel@example.com";

let sends: { message: EmailMessage; idempotencyKey?: string }[];
const deps: JobDeps = {
  sendEmail: async (message, opts) => {
    sends.push({ message, idempotencyKey: opts?.idempotencyKey });
  },
  defer: () => {},
};
const row = async (id: number) => (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;

afterAll(closeDb);
beforeEach(async () => {
  await truncateAll();
  sends = [];
});

const reset = (expiresAt: Date) =>
  queueEmail(
    getDb(),
    { to: TO, template: "reset_password", params: { name: "Maya", url: "https://x/r" }, expiresAt },
    now,
  );

describe("email.send", () => {
  it("sends once, with the job's key as Resend's idempotency key", async () => {
    const id = await reset(new Date(now.getTime() + HOUR));
    expect(await runJob(getDb(), id, deps, now)).toBe("done");
    const job = await row(id);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.message.to).toBe(TO);
    expect(sends[0]!.message.html).toContain("https://x/r");
    expect(sends[0]!.idempotencyKey).toBe(job.idempotencyKey);
    expect(job.idempotencyKey).toMatch(/^email:[0-9a-f-]{36}$/);
    expect(job.payload).toEqual({});
  });

  it("skips an expired link without sending", async () => {
    const id = await reset(new Date(now.getTime() - 1));
    expect(await runJob(getDb(), id, deps, now)).toBe("done");
    expect(sends).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: "done", lastError: "skipped: link expired" });
  });

  it("never records the address when the send fails", async () => {
    const id = await reset(new Date(now.getTime() + HOUR));
    const failing: JobDeps = {
      ...deps,
      sendEmail: async () => {
        throw new Error(`bad to: ${TO}`);
      },
    };
    expect(await runJob(getDb(), id, failing, now)).toBe("failed");
    const job = await row(id);
    expect(job.lastError).toBe("Error");
    expect(job.payload).toMatchObject({ to: TO });
  });

  it("fails an unknown template", async () => {
    const id = await reset(new Date(now.getTime() + HOUR));
    await getDb()
      .update(jobs)
      .set({ payload: { to: TO, template: "gone", params: {} } })
      .where(eq(jobs.id, id));
    expect(await runJob(getDb(), id, deps, now)).toBe("failed");
    expect(sends).toHaveLength(0);
  });

  it("passes the same key on a second run, so Resend sends one email", async () => {
    const id = await queueEmail(getDb(), { to: TO, template: "account_closed" }, now);
    await getDb().update(jobs).set({ status: "failed", runAfter: now }).where(eq(jobs.id, id));
    await runDueJobs(getDb(), deps, now);
    await getDb()
      .update(jobs)
      .set({ status: "queued", payload: { to: TO, template: "account_closed", params: {} } })
      .where(eq(jobs.id, id));
    await runJob(getDb(), id, deps, now);
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((s) => s.idempotencyKey)).size).toBe(1);
  });

  it("runSoon with holdEmails leaves the job queued for a run that sends", async () => {
    const id = await reset(new Date(now.getTime() + HOUR));
    const pending: Promise<unknown>[] = [];
    runSoon(getDb(), id, { ...deps, holdEmails: true, defer: (work) => pending.push(work) });
    await Promise.all(pending);
    expect(sends).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: "queued", attempts: 0 });
  });
});
