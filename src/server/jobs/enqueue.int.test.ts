import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { jobs } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { truncateAll } from "#/test/db";

import { enqueue } from "./enqueue";

// The outbox (4.11, spec call 8): a job is queued in the caller's transaction, once per key.

const at = new Date("2026-11-09T03:00:00Z");
const job = { type: "uploads.cleanup", payload: {}, idempotencyKey: "k1", runAfter: at } as const;

const total = async () => (await getDb().select({ n: count() }).from(jobs))[0]!.n;

afterAll(closeDb);
beforeEach(truncateAll);

describe("enqueue", () => {
  it("leaves no row when the transaction rolls back", async () => {
    await expect(
      withTx(getDb(), async (tx) => {
        await enqueue(tx, job);
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(await total()).toBe(0);
  });

  it("queues one job per key; a second enqueue returns null", async () => {
    expect(await enqueue(getDb(), job)).toEqual(expect.any(Number));
    expect(await enqueue(getDb(), job)).toBeNull();
    expect(await total()).toBe(1);
  });

  it("writes a queued row with no attempts, due at the given time", async () => {
    const id = (await enqueue(getDb(), job))!;
    const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id));
    expect(row).toMatchObject({ status: "queued", attempts: 0, runAfter: at, payload: {} });
  });
});
