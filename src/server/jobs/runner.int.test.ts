import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { jobs } from "#/server/db/schema";
import { truncateAll } from "#/test/db";

import { enqueue } from "./enqueue";
import { runDueJobs, runJob, type Handlers } from "./runner";
import type { JobDeps, JobType } from "./types";

// The runner (4.11, spec calls 4 and 10): claims a due job, runs its handler, and records done,
// failed with a retry time, or dead after 5 attempts.

const HOUR = 60 * 60_000;
const start = new Date("2026-11-09T03:00:00Z");
const later = (ms: number, from = start) => new Date(from.getTime() + ms);

const deps: JobDeps = { sendEmail: async () => {}, defer: () => {} };
const db = () => getDb();

let calls: Map<number, number>;
const counting =
  (result?: () => Promise<{ skipped: string } | void>): Handlers[JobType] =>
  async (job) => {
    calls.set(job.id, (calls.get(job.id) ?? 0) + 1);
    return result?.();
  };
const failing: Handlers[JobType] = async (job) => {
  calls.set(job.id, (calls.get(job.id) ?? 0) + 1);
  throw new Error("Resend is down: maya.patel@example.com");
};

let n = 0;
async function queue(type: JobType = "uploads.cleanup", runAfter = start) {
  return (await enqueue(db(), {
    type,
    payload: { to: "maya.patel@example.com" },
    idempotencyKey: `k${n++}`,
    runAfter,
  }))!;
}
const row = async (id: number) => (await db().select().from(jobs).where(eq(jobs.id, id)))[0]!;

afterAll(closeDb);
beforeEach(async () => {
  await truncateAll();
  calls = new Map();
});

describe("runDueJobs", () => {
  it("retries a failing job at 6, 12, 24 and 48 hours and marks it dead after 5 attempts", async () => {
    const handlers: Handlers = { "uploads.cleanup": failing };
    const id = await queue();
    let now = start;
    for (const [i, hours] of [6, 12, 24, 48].entries()) {
      expect(await runDueJobs(db(), deps, now, { handlers })).toMatchObject({ ran: 1, failed: 1 });
      const failed = await row(id);
      expect(failed).toMatchObject({ status: "failed", attempts: i + 1, lastError: "Error" });
      expect(failed.runAfter).toEqual(later(hours * HOUR, now));
      // A minute early, nothing is due
      expect(
        (await runDueJobs(db(), deps, later(-60_000, failed.runAfter), { handlers })).ran,
      ).toBe(0);
      now = failed.runAfter;
    }
    expect(await runDueJobs(db(), deps, now, { handlers })).toMatchObject({ ran: 1, dead: 1 });
    expect(await row(id)).toMatchObject({ status: "dead", attempts: 5, lastError: "Error" });
    // The payload stays on a dead job, for whoever looks into it
    expect((await row(id)).payload).toEqual({ to: "maya.patel@example.com" });
    expect((await runDueJobs(db(), deps, later(1000 * HOUR), { handlers })).ran).toBe(0);
  });

  it("marks a successful job done, empties its payload and clears last_error", async () => {
    const id = await queue();
    await runDueJobs(db(), deps, start, { handlers: { "uploads.cleanup": counting() } });
    expect(await row(id)).toMatchObject({ status: "done", payload: {}, lastError: null });
  });

  it("records a skip as done with its reason", async () => {
    const id = await queue();
    const handlers = { "uploads.cleanup": counting(async () => ({ skipped: "link expired" })) };
    await runDueJobs(db(), deps, start, { handlers });
    expect(await row(id)).toMatchObject({ status: "done", lastError: "skipped: link expired" });
  });

  it("never gives two runners the same job", async () => {
    const ids = [await queue(), await queue(), await queue()];
    const handlers = { "uploads.cleanup": counting() };
    await Promise.all([
      runDueJobs(db(), deps, start, { handlers }),
      runDueJobs(db(), deps, start, { handlers }),
    ]);
    expect(ids.map((id) => calls.get(id))).toEqual([1, 1, 1]);
  });

  it("takes a running job back after 15 minutes, and marks it dead instead of a 6th attempt", async () => {
    const id = await queue();
    const handlers = { "uploads.cleanup": counting() };
    await db()
      .update(jobs)
      .set({ status: "running", attempts: 1, updatedAt: later(-14 * 60_000) })
      .where(eq(jobs.id, id));
    expect((await runDueJobs(db(), deps, start, { handlers })).ran).toBe(0);

    await db()
      .update(jobs)
      .set({ updatedAt: later(-16 * 60_000) })
      .where(eq(jobs.id, id));
    expect((await runDueJobs(db(), deps, start, { handlers })).ran).toBe(1);
    expect(await row(id)).toMatchObject({ status: "done", attempts: 2 });

    const stuck = await queue();
    await db()
      .update(jobs)
      .set({ status: "running", attempts: 5, updatedAt: later(-16 * 60_000) })
      .where(eq(jobs.id, stuck));
    expect(await runDueJobs(db(), deps, start, { handlers })).toMatchObject({ ran: 0, dead: 1 });
    expect(await row(stuck)).toMatchObject({ status: "dead", attempts: 5, lastError: "timed out" });
    expect(calls.get(stuck)).toBeUndefined();
  });

  it("marks an unknown type dead after 5 runs, and the next job still runs", async () => {
    const unknown = await queue("audit.anchor");
    const next = await queue();
    const handlers = { "uploads.cleanup": counting() };
    let now = start;
    for (let i = 0; i < 5; i++) {
      await runDueJobs(db(), deps, now, { handlers });
      now = (await row(unknown)).runAfter;
    }
    expect(await row(unknown)).toMatchObject({ status: "dead", attempts: 5, lastError: "Error" });
    expect(await row(next)).toMatchObject({ status: "done" });
  });

  it("with holdEmails, leaves email jobs queued and runs the rest", async () => {
    const email = await queue("email.send");
    const other = await queue();
    const handlers = { "email.send": counting(), "uploads.cleanup": counting() };
    const held: JobDeps = { ...deps, holdEmails: true };
    expect(await runDueJobs(db(), held, start, { handlers })).toMatchObject({ ran: 1, done: 1 });
    expect(await row(email)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await row(other)).toMatchObject({ status: "done" });
  });

  it("stops at max", async () => {
    await queue();
    await queue();
    await queue();
    const handlers = { "uploads.cleanup": counting() };
    expect((await runDueJobs(db(), deps, start, { handlers, max: 2 })).ran).toBe(2);
  });
});

describe("runJob", () => {
  it("and a cron run at the same moment call the handler once", async () => {
    const id = await queue();
    const handlers = { "uploads.cleanup": counting() };
    await Promise.all([
      runJob(db(), id, deps, start, handlers),
      runDueJobs(db(), deps, start, { handlers }),
    ]);
    expect(calls.get(id)).toBe(1);
  });

  it("runs nothing for a failed job or one not yet due", async () => {
    const handlers = { "uploads.cleanup": counting() };
    const notDue = await queue("uploads.cleanup", later(HOUR));
    expect(await runJob(db(), notDue, deps, start, handlers)).toBeNull();

    const failed = await queue();
    await db().update(jobs).set({ status: "failed" }).where(eq(jobs.id, failed));
    expect(await runJob(db(), failed, deps, start, handlers)).toBeNull();
    expect(calls.size).toBe(0);
  });

  it("returns the job's new status", async () => {
    const id = await queue();
    expect(await runJob(db(), id, deps, start, { "uploads.cleanup": counting() })).toBe("done");
  });
});
