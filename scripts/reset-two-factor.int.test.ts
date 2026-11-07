import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { parseKeys } from "#/server/audit/chain";
import { verifyAuditChain } from "#/server/audit/verify";
import { closeDb, getDb } from "#/server/db/client";
import { sessions, twoFactors, verifications } from "#/server/db/schema";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeStaff, makeUser } from "#/test/factories";

import { ResetTwoFactorError, resetTwoFactor } from "./reset-two-factor-core.ts";

// auth:reset-two-factor (4.6, call 12): a staff member who lost their phone and backup codes.

let client: pg.Client;
const keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);

beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await closeDb();
});

beforeEach(truncateAll);

/** A user with 2FA on, its two_factors row, a trusted device, an unrelated verification and two sessions */
async function enrolled(email: string) {
  const user = await makeUser({ email, emailVerified: true, twoFactorEnabled: true });
  await makeStaff({ userId: user.id, roles: ["admin"] });
  await getDb()
    .insert(twoFactors)
    .values({ id: randomUUID(), userId: user.id, secret: "s", backupCodes: "b" });
  const later = new Date(Date.now() + 86_400_000);
  await getDb()
    .insert(verifications)
    .values([
      {
        id: randomUUID(),
        identifier: `trust-device-${randomUUID()}`,
        value: user.id,
        expiresAt: later,
      },
      // Not a trusted device, so the reset leaves it
      {
        id: randomUUID(),
        identifier: `reset-password:${randomUUID()}`,
        value: user.id,
        expiresAt: later,
      },
    ]);
  for (let i = 0; i < 2; i++) {
    await getDb().insert(sessions).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: user.id,
      expiresAt: later,
      updatedAt: new Date(),
      twoFactorVerifiedAt: new Date(),
    });
  }
  return user;
}

async function stateOf(userId: string) {
  const user = await client.query<{ two_factor_enabled: boolean }>(
    "select two_factor_enabled from users where id = $1",
    [userId],
  );
  const count = async (table: string, where = "user_id = $1") =>
    (await client.query(`select 1 from ${table} where ${where}`, [userId])).rowCount;
  return {
    enabled: user.rows[0]!.two_factor_enabled,
    twoFactors: await count("two_factors"),
    trustedDevices: await count("verifications", "value = $1 and identifier like 'trust-device-%'"),
    otherVerifications: await count(
      "verifications",
      "value = $1 and identifier not like 'trust-device-%'",
    ),
    sessions: await count("sessions"),
  };
}

const enrolledState = {
  enabled: true,
  twoFactors: 1,
  trustedDevices: 1,
  otherVerifications: 1,
  sessions: 2,
};

describe("resetTwoFactor", () => {
  it("turns 2FA off and removes trusted devices and sessions", async () => {
    const user = await enrolled("sam@example.com");
    const other = await enrolled("ann@example.com");

    expect(await resetTwoFactor(client, "  Sam@Example.com ", keys)).toEqual({ userId: user.id });

    expect(await stateOf(user.id)).toEqual({
      enabled: false,
      twoFactors: 0,
      trustedDevices: 0,
      otherVerifications: 1,
      sessions: 0,
    });
    // Someone else's 2FA is untouched
    expect(await stateOf(other.id)).toEqual(enrolledState);
  });

  it("writes two_factor.reset with a null actor; the chain verifies", async () => {
    const user = await enrolled("sam@example.com");
    await resetTwoFactor(client, "sam@example.com", keys);

    const written = await client.query(
      "select action, entity_type, entity_id, actor_user_id, actor_role, changes from audit_log",
    );
    expect(written.rows).toEqual([
      {
        action: "two_factor.reset",
        entity_type: "user",
        entity_id: user.id,
        actor_user_id: null,
        actor_role: null,
        changes: null,
      },
    ]);
    expect(await verifyAuditChain(getOwnerDb().$client, keys)).toMatchObject({
      ok: true,
      rows: 1,
    });
  });

  it("an unknown email is refused and nothing changes", async () => {
    const user = await enrolled("sam@example.com");
    const error = await resetTwoFactor(client, "nobody@example.com", keys).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResetTwoFactorError);
    expect((error as ResetTwoFactorError).reason).toBe("unknown_email");
    expect(await stateOf(user.id)).toEqual(enrolledState);
    expect((await client.query("select 1 from audit_log")).rowCount).toBe(0);
  });

  it("rolls every change back when the audit insert fails", async () => {
    const user = await enrolled("sam@example.com");
    const failing = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop !== "query") return Reflect.get(target, prop, receiver);
        return (text: unknown, ...rest: unknown[]) => {
          if (typeof text === "string" && text.includes("insert into audit_log")) {
            return Promise.reject(new Error("boom"));
          }
          return (target.query as (...args: unknown[]) => unknown)(text, ...rest);
        };
      },
    });
    await expect(resetTwoFactor(failing, "sam@example.com", keys)).rejects.toThrow("boom");
    expect(await stateOf(user.id)).toEqual(enrolledState);
  });

  it("writes nothing when the active key is not loaded", async () => {
    const user = await enrolled("sam@example.com");
    const noKey = { activeVersion: "v2", keys: new Map<string, Buffer>() };
    await expect(resetTwoFactor(client, "sam@example.com", noKey)).rejects.toThrow(
      /Audit key version v2 is not loaded/,
    );
    expect(await stateOf(user.id)).toEqual(enrolledState);
    expect((await client.query("select 1 from audit_log")).rowCount).toBe(0);
  });
});
