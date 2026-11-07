import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { verifyAuditChain } from "#/server/audit/verify";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, securityEvents, sessions, verifications } from "#/server/db/schema";
import { getAuditEnv } from "#/server/env";
import { env, googleSession, makeAuth, post } from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeUser } from "#/test/factories";

import { getActor, resolveActor } from "./actor";
import { signOutEverywhere } from "./sessions";

// "Sign out everywhere" (4.6, call 11): one transaction deletes the sessions and writes
// sessions.revoked_all, and it leaves the database as Better Auth's own /revoke-sessions would.

afterAll(closeDb);

beforeEach(async () => {
  await truncateAll();
  // getActor builds the app's auth instance, and the security event needs its secret (R8)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const sessionsOf = (userId: string) =>
  getDb().select().from(sessions).where(eq(sessions.userId, userId));

const signedOutEvents = (userId: string) =>
  getDb()
    .select()
    .from(securityEvents)
    .where(
      and(eq(securityEvents.userId, userId), eq(securityEvents.type, "signed_out_everywhere")),
    );

/** A verified user without 2FA and `count` signed-in sessions; returns the cookies */
async function userWithSessions(count: number) {
  const auth = makeAuth();
  const user = await makeUser({ emailVerified: true });
  const cookies: string[] = [];
  for (let i = 0; i < count; i++) cookies.push(await googleSession(auth, user.id));
  return { auth, user, cookies };
}

async function actorOf(userId: string) {
  const actor = await resolveActor(getDb(), userId);
  expect(actor).not.toBeNull();
  return actor!;
}

/** Rows per table in `public`, as the owner sees them */
async function tableCounts(): Promise<Record<string, number>> {
  const owner = getOwnerDb();
  const { rows } = await owner.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of rows) {
    const result = await owner.execute<{ n: number }>(
      sql.raw(`select count(*)::int as n from "public"."${tablename}"`),
    );
    counts[tablename] = result.rows[0]!.n;
  }
  return counts;
}

function diff(before: Record<string, number>, after: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const table of Object.keys(after)) {
    const change = after[table]! - (before[table] ?? 0);
    if (change !== 0) out[table] = change;
  }
  return out;
}

const allVerifications = () =>
  getDb().select().from(verifications).orderBy(verifications.identifier);

describe("signOutEverywhere (4.6, call 11)", () => {
  it("ends every session", async () => {
    const { user, cookies } = await userWithSessions(3);
    for (const cookie of cookies) {
      expect((await getActor(new Headers({ cookie })))?.userId).toBe(user.id);
    }

    const result = await signOutEverywhere(getDb(), await actorOf(user.id));

    expect(result).toEqual({ revoked: 3 });
    expect(await sessionsOf(user.id)).toHaveLength(0);
    for (const cookie of cookies) {
      expect(await getActor(new Headers({ cookie }))).toBeNull();
    }
    expect(await signedOutEvents(user.id)).toHaveLength(1);
  });

  it("writes sessions.revoked_all with the count and the chain verifies", async () => {
    const { user } = await userWithSessions(3);
    await signOutEverywhere(getDb(), await actorOf(user.id));

    const rows = await getDb().select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "sessions.revoked_all",
      entityType: "user",
      entityId: user.id,
      actorUserId: user.id,
      actorRole: "customer",
      changes: { revoked: 3 },
    });
    expect(await verifyAuditChain(getDb().$client, getAuditEnv())).toMatchObject({
      ok: true,
      rows: 1,
    });
  });

  it("a failed audit write rolls back", async () => {
    const { user } = await userWithSessions(3);
    const unloaded = { activeVersion: "v9", keys: getAuditEnv().keys };

    await expect(
      signOutEverywhere(getDb(), await actorOf(user.id), undefined, unloaded),
    ).rejects.toThrow(/Audit key version v9 is not loaded/);

    expect(await sessionsOf(user.id)).toHaveLength(3);
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
    expect(await signedOutEvents(user.id)).toHaveLength(0);
  });

  it("leaves the database as revokeSessions does", async () => {
    const a = await userWithSessions(2);
    const b = await userWithSessions(2);
    // Trusted devices for both, so a stray verifications delete would show
    for (const userId of [a.user.id, b.user.id]) {
      await getDb()
        .insert(verifications)
        .values({
          id: randomUUID(),
          identifier: `trust-device-${randomUUID()}`,
          value: userId,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
    }
    const verificationsBefore = await allVerifications();
    const start = await tableCounts();

    await signOutEverywhere(getDb(), await actorOf(a.user.id));
    const afterOurs = await tableCounts();

    const revoked = await post(b.auth, "/revoke-sessions", {}, { cookie: b.cookies[0]! });
    expect(revoked.status).toBe(200);
    const afterTheirs = await tableCounts();

    expect(await sessionsOf(a.user.id)).toHaveLength(0);
    expect(await sessionsOf(b.user.id)).toHaveLength(0);
    // Ours adds only its audit row and its security event on top of the same delete
    expect(diff(start, afterOurs)).toEqual({ sessions: -2, audit_log: 1, security_events: 1 });
    expect(diff(afterOurs, afterTheirs)).toEqual({ sessions: -2 });
    expect(await allVerifications()).toEqual(verificationsBefore);
  });
});
