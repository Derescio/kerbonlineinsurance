import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { accountClosures, files, idempotencyKeys, jobs, rateLimits } from "#/server/db/schema";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { env, sent } from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeCustomer, makeFile, makePolicy, makeUser } from "#/test/factories";

import { DAILY_JOBS, queueDailyJobs } from "./daily";
import { runDueJobs } from "./runner";
import type { JobDeps } from "./types";

// The daily jobs (4.11, spec calls 6 and 13): queued once per UTC day by the daily cron, then run
// in order by the same runner as every other job.

const DAY = 24 * 60 * 60_000;
const now = new Date("2026-11-09T03:00:00Z");

const pending: Promise<unknown>[] = [];
const deps: JobDeps = {
  sendEmail: async (message) => {
    sent.push(message);
  },
  defer: (work) => {
    pending.push(work);
  },
};
let store: MemoryObjectStore;

const allJobs = () => getDb().select().from(jobs).orderBy(jobs.id);

afterAll(closeDb);
beforeEach(async () => {
  // getActor reads the auth env, which this project doesn't set
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  sent.length = 0;
  pending.length = 0;
  store = new MemoryObjectStore();
  setObjectStore(store);
});
afterEach(() => {
  setObjectStore(null);
  vi.unstubAllEnvs();
});

describe("queueDailyJobs", () => {
  it("queues the four daily jobs once per day, in order", async () => {
    expect(await queueDailyJobs(getDb(), now)).toBe(4);
    expect(await queueDailyJobs(getDb(), new Date(now.getTime() + 60_000))).toBe(0);
    expect((await allJobs()).map((j) => [j.type, j.idempotencyKey])).toEqual(
      DAILY_JOBS.map((type) => [type, `${type}:2026-11-09`]),
    );
    expect(await queueDailyJobs(getDb(), new Date(now.getTime() + DAY))).toBe(4);
    expect(await allJobs()).toHaveLength(8);
  });
});

describe("a daily run", () => {
  /** A user whose 30-day closure window ended a day before `now`, with a policy on file */
  async function dueClosure() {
    const user = await makeUser();
    const customer = await makeCustomer({ userId: user.id });
    await makePolicy({ customerId: customer.id });
    const [closure] = await getDb()
      .insert(accountClosures)
      .values({
        userId: user.id,
        requestedAt: new Date(now.getTime() - 31 * DAY),
        closesAt: new Date(now.getTime() - DAY),
      })
      .returning();
    return closure!;
  }

  /** An upload never confirmed, 25 hours before `now` */
  async function staleUpload() {
    const file = await makeFile({ status: "pending" });
    await getOwnerDb()
      .update(files)
      .set({ createdAt: new Date(now.getTime() - 25 * 60 * 60_000) })
      .where(eq(files.id, file.id));
    store.put(file.objectKey, new Uint8Array([1]), file.mime);
    return file;
  }

  it("closes a due closure and purges a stale upload", async () => {
    const closure = await dueClosure();
    const file = await staleUpload();

    await queueDailyJobs(getDb(), now);
    await runDueJobs(getDb(), deps, now);
    await Promise.all(pending.splice(0));

    // audit.anchor is covered in Task 5's tests until its handler lands (4.11 plan)
    const daily = (await allJobs()).filter(
      (j) => j.type !== "email.send" && j.type !== "audit.anchor",
    );
    expect(daily.map((j) => [j.type, j.status])).toEqual(
      DAILY_JOBS.filter((t) => t !== "audit.anchor").map((t) => [t, "done"]),
    );
    const [after] = await getDb()
      .select()
      .from(accountClosures)
      .where(eq(accountClosures.id, closure.id));
    expect(after!.closedAt).not.toBeNull();
    expect(store.has(file.objectKey)).toBe(false);
    // The account-closed email went as its own job
    expect(sent.map((m) => m.subject)).toEqual(["Your Kerb account is closed"]);
  });

  it("changes nothing on a second run the same day", async () => {
    await dueClosure();
    await queueDailyJobs(getDb(), now);
    await runDueJobs(getDb(), deps, now);
    await Promise.all(pending.splice(0));
    const before = await allJobs();

    await queueDailyJobs(getDb(), now);
    expect(await runDueJobs(getDb(), deps, now)).toMatchObject({ ran: 0 });
    expect(await allJobs()).toEqual(before);
    expect(sent).toHaveLength(1);
  });

  it("leaves a cleanup that failed for some files failed, with a retry time", async () => {
    await staleUpload();
    store.failDeletes = true;
    await queueDailyJobs(getDb(), now);
    await runDueJobs(getDb(), deps, now);
    const [cleanup] = (await allJobs()).filter((j) => j.type === "uploads.cleanup");
    expect(cleanup).toMatchObject({ status: "failed", attempts: 1, lastError: "Error" });
    expect(cleanup!.runAfter).toEqual(new Date(now.getTime() + 6 * 60 * 60_000));
  });
});

describe("housekeeping.expired_rows", () => {
  it("deletes expired keys, old rate-limit windows and old finished jobs, and keeps the rest", async () => {
    const user = await makeUser();
    const key = (expiresAt: Date) => ({
      userId: user.id,
      key: randomUUID(),
      requestHash: "h",
      expiresAt,
    });
    await getDb()
      .insert(idempotencyKeys)
      .values([key(new Date(now.getTime() - 60_000)), key(new Date(now.getTime() + DAY))]);
    await getDb()
      .insert(rateLimits)
      .values([
        { key: "old", windowStart: new Date(now.getTime() - 2 * DAY), count: 1 },
        { key: "fresh", windowStart: new Date(now.getTime() - 60_000), count: 1 },
      ]);
    const job = (status: "done" | "dead", days: number) => ({
      type: "uploads.cleanup",
      payload: {},
      status,
      idempotencyKey: randomUUID(),
      updatedAt: new Date(now.getTime() - days * DAY),
    });
    await getDb()
      .insert(jobs)
      .values([job("done", 8), job("done", 6), job("dead", 31), job("dead", 29)]);

    await getDb().insert(jobs).values({
      type: "housekeeping.expired_rows",
      payload: {},
      idempotencyKey: "housekeeping",
      runAfter: now,
    });
    await runDueJobs(getDb(), deps, now);

    expect(
      await getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(idempotencyKeys),
    ).toEqual([{ n: 1 }]);
    expect((await getDb().select().from(rateLimits)).map((r) => r.key)).toEqual(["fresh"]);
    const left = (await allJobs()).filter((j) => j.type === "uploads.cleanup");
    expect(left.map((j) => j.status).sort()).toEqual(["dead", "done"]);
  });
});
