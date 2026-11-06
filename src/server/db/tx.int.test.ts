import { count, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { Rejected, rejected } from "#/lib/validation";
import { closeDb, getDb } from "#/server/db/client";
import { jobs, rateLimits } from "#/server/db/schema";
import { truncateAll } from "#/test/db";

import { withTx, type Tx } from "./tx";

async function insertBoth(tx: Tx) {
  await tx.insert(jobs).values({ type: "test", payload: {}, idempotencyKey: "tx-test" });
  await tx.insert(rateLimits).values({ key: "tx-test", windowStart: new Date() });
}

async function counts() {
  const db = getDb();
  const [j] = await db.select({ n: count() }).from(jobs);
  const [r] = await db.select({ n: count() }).from(rateLimits);
  return { jobs: j?.n, rateLimits: r?.n };
}

describe("withTx", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("rolls back every table on a throw", async () => {
    const boom = new Error("boom");
    await expect(
      withTx(getDb(), async (tx) => {
        await insertBoth(tx);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await counts()).toEqual({ jobs: 0, rateLimits: 0 });
  });

  it("commits and returns the value", async () => {
    await expect(
      withTx(getDb(), async (tx) => {
        await insertBoth(tx);
        return 42;
      }),
    ).resolves.toBe(42);
    expect(await counts()).toEqual({ jobs: 1, rateLimits: 1 });
  });

  it("rolls back and returns a Rejected", async () => {
    const no = rejected("No.");
    const result = await withTx(getDb(), async (tx) => {
      await insertBoth(tx);
      return no;
    });
    expect(result).toBe(no);
    expect(result).toBeInstanceOf(Rejected);
    expect(await counts()).toEqual({ jobs: 0, rateLimits: 0 });
  });

  it("sets the timeouts for this transaction only", async () => {
    const show = async (
      tx: Tx | ReturnType<typeof getDb>,
      name: "statement_timeout" | "lock_timeout",
    ) => {
      const { rows } = await tx.execute<Record<string, string>>(sql.raw(`show ${name}`));
      return rows[0]?.[name];
    };
    await withTx(getDb(), async (tx) => {
      expect(await show(tx, "statement_timeout")).toBe("10s");
      expect(await show(tx, "lock_timeout")).toBe("5s");
    });
    expect(await show(getDb(), "statement_timeout")).toBe("0");
  });
});
