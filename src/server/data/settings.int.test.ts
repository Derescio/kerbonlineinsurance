import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { AuthzError, IdempotencyConflictError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, customers, idempotencyKeys, securityEvents } from "#/server/db/schema";
import { requestHash } from "#/server/db/idempotency";
import { truncateAll } from "#/test/db";
import { makeCustomer, makeUser } from "#/test/factories";

import { getMyPersonalDetails, getMyRecentActivity, updateMyPhone } from "./settings";

// Account settings (6.3): the details and activity reads, and the audited, idempotent mobile save.

// The mobile's request hash is keyed with BETTER_AUTH_SECRET, read from the whole auth env, which
// this project doesn't set (as define.int.test.ts)
beforeAll(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "integration-secret-integration-secret-0123");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kerb <hello@example.com>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
});
beforeEach(truncateAll);
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const ctx = { headers: new Headers() };

async function signedInCustomer() {
  const user = await makeUser({ name: "Maya Patel", email: "maya@example.test" });
  const customer = await makeCustomer({
    userId: user.id,
    firstName: "Maya",
    lastName: "Patel",
    dateOfBirth: "1991-06-14",
    addressLine1: "Flat 3, 28 Mare Street",
    town: "London",
    postcode: "E8 3RL",
  });
  const actor = (await resolveActor(getDb(), user.id))!;
  return { user, customer, actor };
}

async function signedInUserOnly() {
  const user = await makeUser({ name: "Sam Lee", email: "sam@example.test" });
  const actor = (await resolveActor(getDb(), user.id))!;
  return { user, actor };
}

const phoneAudits = () =>
  getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "customer.phone_changed"))
    .orderBy(asc(auditLog.id));

describe("getMyPersonalDetails", () => {
  it("returns the customer's details and the user's email", async () => {
    const { actor } = await signedInCustomer();
    expect(await getMyPersonalDetails(actor, {})).toEqual({
      name: "Maya Patel",
      email: "maya@example.test",
      customer: {
        firstName: "Maya",
        lastName: "Patel",
        dateOfBirth: "1991-06-14",
        phone: null,
        addressLine1: "Flat 3, 28 Mare Street",
        addressLine2: null,
        town: "London",
        postcode: "E8 3RL",
      },
    });
  });

  it("has no customer for a user who never saved a quote", async () => {
    const { actor } = await signedInUserOnly();
    expect(await getMyPersonalDetails(actor, {})).toEqual({
      name: "Sam Lee",
      email: "sam@example.test",
      customer: null,
    });
  });

  it("refuses a guest", async () => {
    await expect(getMyPersonalDetails(null, {})).rejects.toThrow(AuthzError);
  });
});

describe("getMyRecentActivity", () => {
  it("returns the user's 10 newest events, newest first, without the IP hash", async () => {
    const { user, actor } = await signedInCustomer();
    const other = await makeUser();
    const base = Date.parse("2026-11-01T10:00:00Z");
    await getDb()
      .insert(securityEvents)
      .values([
        ...Array.from({ length: 12 }, (_, i) => ({
          userId: user.id,
          type: "sign_in" as const,
          method: "password" as const,
          ipHash: "a".repeat(64),
          userAgentSummary: "Chrome on Windows",
          createdAt: new Date(base + i * 60_000),
        })),
        { userId: other.id, type: "sign_in_failed" as const, createdAt: new Date(base + 99e6) },
      ]);

    const activity = await getMyRecentActivity(actor, {});
    expect(activity).toHaveLength(10);
    expect(activity[0]).toEqual({
      type: "sign_in",
      method: "password",
      device: "Chrome on Windows",
      at: new Date(base + 11 * 60_000).toISOString(),
    });
    expect(activity[9]!.at).toBe(new Date(base + 2 * 60_000).toISOString());
    for (const row of activity) expect(row).not.toHaveProperty("ipHash");
  });

  it("refuses a guest", async () => {
    await expect(getMyRecentActivity(null, {})).rejects.toThrow(AuthzError);
  });
});

describe("updateMyPhone", () => {
  it("saves the normalised number and audits that it was set, never the number", async () => {
    const { customer, actor } = await signedInCustomer();
    const result = await updateMyPhone(
      actor,
      { input: { phone: "+44 7700 900418" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result).toEqual({ ok: true, data: { set: true } });

    const row = await getDb().query.customers.findFirst({ where: eq(customers.id, customer.id) });
    expect(row!.phone).toBe("07700 900418");
    const audits = await phoneAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entityId).toBe(customer.id);
    expect(audits[0]!.changes).toEqual({ phone: { set: true } });
    expect(JSON.stringify(audits[0])).not.toContain("7700");
    // The replay copy holds no personal data either (idempotency.ts)
    const keys = await getDb().select().from(idempotencyKeys);
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(keys[0]!.response)).not.toContain("7700");
    // Nor its request hash: a plain hash of a UK mobile (about 10^9 of them) can be reversed by
    // trying them all, so the number is keyed with a server secret first
    expect(keys[0]!.requestHash).not.toBe(
      requestHash("account.update_phone", { phone: "07700 900418" }),
    );
  });

  it("still replays a retry under the keyed hash", async () => {
    const { actor } = await signedInCustomer();
    const envelope = { input: { phone: "+44 7700 900418" }, idempotencyKey: randomUUID() };
    await updateMyPhone(actor, envelope, ctx);
    // The same number written another way is the same request
    const again = { input: { phone: "07700900418" }, idempotencyKey: envelope.idempotencyKey };
    expect(await updateMyPhone(actor, again, ctx)).toEqual({ ok: true, data: { set: true } });
    expect(await phoneAudits()).toHaveLength(1);
  });

  it("changes and audits once for a retried key", async () => {
    const { actor } = await signedInCustomer();
    const envelope = { input: { phone: "07700 900418" }, idempotencyKey: randomUUID() };
    const first = await updateMyPhone(actor, envelope, ctx);
    const second = await updateMyPhone(actor, envelope, ctx);
    expect(second).toEqual(first);
    expect(await phoneAudits()).toHaveLength(1);
  });

  it("refuses a key reused for a different number, changing nothing", async () => {
    const { customer, actor } = await signedInCustomer();
    const key = randomUUID();
    await updateMyPhone(actor, { input: { phone: "07700 900418" }, idempotencyKey: key }, ctx);
    await expect(
      updateMyPhone(actor, { input: { phone: "07700 900999" }, idempotencyKey: key }, ctx),
    ).rejects.toThrow(IdempotencyConflictError);
    const row = await getDb().query.customers.findFirst({ where: eq(customers.id, customer.id) });
    expect(row!.phone).toBe("07700 900418");
  });

  it("clears the number with a blank, audited as unset", async () => {
    const { customer, actor } = await signedInCustomer();
    await getDb()
      .update(customers)
      .set({ phone: "07700 900418" })
      .where(eq(customers.id, customer.id));
    const result = await updateMyPhone(
      actor,
      { input: { phone: "" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result).toEqual({ ok: true, data: { set: false } });
    expect((await phoneAudits())[0]!.changes).toEqual({ phone: { set: false } });
  });

  it("refuses a landline with the field's message and writes nothing", async () => {
    const { customer, actor } = await signedInCustomer();
    const result = await updateMyPhone(
      actor,
      { input: { phone: "020 7946 0018" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fields).toEqual({ phone: "Enter a UK mobile number, like 07700 900418" });
    const row = await getDb().query.customers.findFirst({ where: eq(customers.id, customer.id) });
    expect(row!.phone).toBeNull();
    expect(await phoneAudits()).toHaveLength(0);
  });

  it("refuses a user without a customer record", async () => {
    const { actor } = await signedInUserOnly();
    const result = await updateMyPhone(
      actor,
      { input: { phone: "07700 900418" }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: "Save a quote first to add a mobile number." }),
    });
    expect(await phoneAudits()).toHaveLength(0);
  });

  it("refuses a guest", async () => {
    await expect(
      updateMyPhone(null, { input: { phone: "07700 900418" }, idempotencyKey: randomUUID() }, ctx),
    ).rejects.toThrow(AuthzError);
  });
});
