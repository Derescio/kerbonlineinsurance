import { randomUUID } from "node:crypto";

import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { rejected } from "#/lib/validation";
import { audit } from "#/server/audit/audit";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError, RateLimitError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, idempotencyKeys, jobs, rateLimits } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer } from "#/test/factories";

import { defineWrite } from "./define";

// defineWrite's order (spec call 10): access, validation, replay, limit, then the transaction.

const schema = z.object({ title: z.string().trim().min(1, "Enter a title.") });

const run = async (
  actor: Actor,
  data: { title: string },
  tx: Parameters<Parameters<typeof defineWrite>[2]>[2],
) => {
  if (data.title === "Expired") return rejected("This quote has expired.");
  const [job] = await tx
    .insert(jobs)
    .values({ type: "test", payload: data, idempotencyKey: randomUUID() })
    .returning({ id: jobs.id });
  const jobId = job!.id;
  await audit(tx, {
    actor,
    action: "test.written",
    entityType: "job",
    entityId: String(jobId),
  });
  return { jobId };
};

const write = defineWrite(
  schema,
  {
    limit: { action: "test.write", rule: { max: 2, windowSeconds: 86400 } },
    idempotent: { action: "test.write" },
  },
  run,
);
const plain = defineWrite(schema, {}, run);

const ctx = { headers: new Headers() };

async function rows(table: PgTable) {
  const [row] = await getDb().select({ n: count() }).from(table);
  return row!.n;
}

let actor: Actor;

// rateLimitSubject reads its secret from the whole auth env, which this project doesn't set
beforeAll(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "integration-secret-integration-secret-0123");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kerb <hello@example.com>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
});

beforeEach(async () => {
  await truncateAll();
  const customer = await makeCustomer();
  actor = (await resolveActor(getDb(), customer.userId))!;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("defineWrite", () => {
  it("declares its access and kind", () => {
    expect(write.access).toBe("signed_in");
    expect(write.kind).toBe("write");
  });

  it("rejects a guest before anything is counted", async () => {
    const error = await write(null, { input: { title: "Car" }, idempotencyKey: randomUUID() }, ctx)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthzError);
    expect((error as AuthzError).code).toBe("UNAUTHENTICATED");
    expect(await rows(rateLimits)).toBe(0);
  });

  it("returns field errors for a bad input without counting or writing", async () => {
    const result = await write(actor, { input: { title: "" }, idempotencyKey: randomUUID() }, ctx);
    expect(result).toMatchObject({ ok: false, error: { fields: { title: "Enter a title." } } });
    expect(await rows(rateLimits)).toBe(0);
    expect(await rows(jobs)).toBe(0);
  });

  it.each([[undefined], ["not-a-uuid"]])("fails on idempotencyKey %s", async (key) => {
    const result = await write(actor, { input: { title: "Car" }, idempotencyKey: key }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields.idempotencyKey).toBeTruthy();
    expect(await rows(jobs)).toBe(0);
  });

  it("fails, rather than throws, when the envelope is missing", async () => {
    const result = await write(actor, undefined as never, ctx);
    expect(result.ok).toBe(false);
  });

  it("reports the input and the key together", async () => {
    const result = await write(actor, { input: { title: "" } }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fields.title).toBe("Enter a title.");
      expect(result.error.fields.idempotencyKey).toBeTruthy();
    }
  });

  it("refuses a third call with fresh keys, leaving no key or job row", async () => {
    for (let i = 0; i < 2; i++) {
      await write(actor, { input: { title: "Car" }, idempotencyKey: randomUUID() }, ctx);
    }
    await expect(
      write(actor, { input: { title: "Car" }, idempotencyKey: randomUUID() }, ctx),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(await rows(idempotencyKeys)).toBe(2);
    expect(await rows(jobs)).toBe(2);
  });

  it("replays a committed key after the limit is used up, without counting", async () => {
    const key = randomUUID();
    const first = await write(actor, { input: { title: "Car" }, idempotencyKey: key }, ctx);
    await write(actor, { input: { title: "Car" }, idempotencyKey: randomUUID() }, ctx);
    const counted = await getDb().select().from(rateLimits);
    const replay = await write(actor, { input: { title: "Car" }, idempotencyKey: key }, ctx);
    expect(replay).toEqual(first);
    expect(replay.ok).toBe(true);
    expect(await getDb().select().from(rateLimits)).toEqual(counted);
  });

  it("treats a trimmed-equal payload under one key as a replay", async () => {
    const key = randomUUID();
    const first = await write(actor, { input: { title: " Car " }, idempotencyKey: key }, ctx);
    const second = await write(actor, { input: { title: "Car" }, idempotencyKey: key }, ctx);
    expect(second).toEqual(first);
    expect(await rows(jobs)).toBe(1);
  });

  it("returns a Rejected as a failure and rolls everything back but the limit count", async () => {
    const result = await write(
      actor,
      { input: { title: "Expired" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, error: { message: "This quote has expired." } });
    expect(await rows(jobs)).toBe(0);
    expect(await rows(idempotencyKeys)).toBe(0);
    expect(await rows(auditLog)).toBe(0);
    expect(await rows(rateLimits)).toBe(1);
  });

  it("writes a job, a key row holding the response and an audit row", async () => {
    const result = await write(
      actor,
      { input: { title: "Car" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(await rows(jobs)).toBe(1);
    expect(await rows(auditLog)).toBe(1);
    const keys = await getDb().select().from(idempotencyKeys);
    expect(keys).toHaveLength(1);
    if (result.ok) expect(keys[0]!.response).toEqual(result.data);
  });

  it("lets a non-idempotent write ignore the key", async () => {
    const result = await plain(actor, { input: { title: "Car" } }, ctx);
    expect(result.ok).toBe(true);
    expect(await rows(jobs)).toBe(1);
    expect(await rows(idempotencyKeys)).toBe(0);
  });
});
