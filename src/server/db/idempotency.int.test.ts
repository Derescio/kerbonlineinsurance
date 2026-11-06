import { randomUUID } from "node:crypto";

import { count } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { Rejected, rejected } from "#/lib/validation";
import type { JsonValue } from "#/server/audit/chain";
import { IdempotencyConflictError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { idempotencyKeys, jobs } from "#/server/db/schema";
import { tamper, truncateAll } from "#/test/db";
import { makeCustomer } from "#/test/factories";

import { findReplay, withIdempotency, type IdempotencyInput } from "./idempotency";
import type { Tx } from "./tx";

async function counts() {
  const db = getDb();
  const [k] = await db.select({ n: count() }).from(idempotencyKeys);
  const [j] = await db.select({ n: count() }).from(jobs);
  return { keys: k?.n, jobs: j?.n };
}

const expire = () => tamper("update idempotency_keys set expires_at = now() - interval '1 minute'");

afterAll(closeDb);

describe("withIdempotency", () => {
  let userId: string;
  let calls: number;
  let input: IdempotencyInput;

  const run = async (tx: Tx) => {
    calls++;
    const [job] = await tx
      .insert(jobs)
      .values({ type: "test", payload: {}, idempotencyKey: randomUUID() })
      .returning({ id: jobs.id });
    return { jobId: job!.id };
  };

  beforeEach(async () => {
    await truncateAll();
    userId = (await makeCustomer()).userId;
    calls = 0;
    input = { userId, key: randomUUID(), action: "test.save", payload: { x: 1 } };
  });

  it("runs the first call once", async () => {
    const result = await withIdempotency(getDb(), input, run);
    expect(result).toEqual({ jobId: expect.any(Number) });
    expect(calls).toBe(1);
    expect(await counts()).toEqual({ keys: 1, jobs: 1 });
  });

  it("returns an equal result for a repeat without running again", async () => {
    const first = await withIdempotency(getDb(), input, run);
    const second = await withIdempotency(getDb(), input, run);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(await counts()).toEqual({ keys: 1, jobs: 1 });
  });

  it("refuses the same key with another payload", async () => {
    await withIdempotency(getDb(), input, run);
    await expect(
      withIdempotency(getDb(), { ...input, payload: { x: 2 } }, run),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(calls).toBe(1);
  });

  it("refuses the same key with another action", async () => {
    await withIdempotency(getDb(), input, run);
    await expect(
      withIdempotency(getDb(), { ...input, action: "test.other" }, run),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(calls).toBe(1);
  });

  it("leaves no key row when run throws, and the retry runs", async () => {
    const boom = new Error("boom");
    await expect(
      withIdempotency(getDb(), input, async (tx) => {
        await run(tx);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await counts()).toEqual({ keys: 0, jobs: 0 });
    await withIdempotency(getDb(), input, run);
    expect(calls).toBe(2);
    expect(await counts()).toEqual({ keys: 1, jobs: 1 });
  });

  it("leaves no key row and no write when run returns rejected, and the retry runs", async () => {
    const no = rejected("No.");
    const result = await withIdempotency(getDb(), input, async (tx) => {
      await run(tx);
      return no;
    });
    expect(result).toBe(no);
    expect(result).toBeInstanceOf(Rejected);
    expect(await counts()).toEqual({ keys: 0, jobs: 0 });
    await withIdempotency(getDb(), input, run);
    expect(calls).toBe(2);
    expect(await counts()).toEqual({ keys: 1, jobs: 1 });
  });

  it("runs two simultaneous calls with one key once", async () => {
    const slow = async (tx: Tx) => {
      const result = await run(tx);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return result;
    };
    const [a, b] = await Promise.all([
      withIdempotency(getDb(), input, slow),
      withIdempotency(getDb(), input, slow),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(await counts()).toEqual({ keys: 1, jobs: 1 });
  });

  it("runs again once the key has expired", async () => {
    await withIdempotency(getDb(), input, run);
    await expire();
    const second = await withIdempotency(getDb(), input, run);
    expect(calls).toBe(2);
    expect(second).toEqual({ jobId: expect.any(Number) });
    expect(await counts()).toEqual({ keys: 1, jobs: 2 });
  });

  it("runs an expired key fresh with another payload, not as a conflict", async () => {
    await withIdempotency(getDb(), input, run);
    await expire();
    await expect(withIdempotency(getDb(), { ...input, payload: { x: 2 } }, run)).resolves.toEqual({
      jobId: expect.any(Number),
    });
    expect(calls).toBe(2);
    // The replaced row now holds the new request
    await expect(findReplay(getDb(), { ...input, payload: { x: 2 } })).resolves.not.toBeNull();
  });

  it("keeps two users with the same key apart", async () => {
    const other = (await makeCustomer()).userId;
    const a = await withIdempotency(getDb(), input, run);
    const b = await withIdempotency(getDb(), { ...input, userId: other }, run);
    expect(calls).toBe(2);
    expect(a).not.toEqual(b);
    expect(await counts()).toEqual({ keys: 2, jobs: 2 });
  });

  it("returns a Date as the same ISO string both times", async () => {
    const at = new Date("2026-11-05T10:00:00.000Z");
    const dated = async () => ({ at }) as unknown as JsonValue;
    const first = await withIdempotency(getDb(), input, dated);
    const second = await withIdempotency(getDb(), input, dated);
    expect(first).toEqual({ at: "2026-11-05T10:00:00.000Z" });
    expect(second).toEqual({ at: "2026-11-05T10:00:00.000Z" });
  });
});

describe("findReplay", () => {
  let input: IdempotencyInput;

  beforeEach(async () => {
    await truncateAll();
    const userId = (await makeCustomer()).userId;
    input = { userId, key: randomUUID(), action: "test.save", payload: { x: 1 } };
  });

  it("returns the stored response for the same request", async () => {
    await withIdempotency(getDb(), input, async () => ({ ok: 1 }));
    await expect(findReplay(getDb(), input)).resolves.toEqual({ response: { ok: 1 } });
  });

  it("refuses another request", async () => {
    await withIdempotency(getDb(), input, async () => ({ ok: 1 }));
    await expect(findReplay(getDb(), { ...input, payload: { x: 2 } })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it("returns null for a missing key", async () => {
    await expect(findReplay(getDb(), input)).resolves.toBeNull();
  });

  it("returns null for an expired key", async () => {
    await withIdempotency(getDb(), input, async () => ({ ok: 1 }));
    await expire();
    await expect(findReplay(getDb(), input)).resolves.toBeNull();
  });
});
