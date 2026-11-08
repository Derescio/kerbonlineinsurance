import { count, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { audit } from "#/server/audit/audit";
import { parseKeys } from "#/server/audit/chain";
import { verifyAuditChain } from "#/server/audit/verify";
import { getDb } from "#/server/db/client";
import { dataContract } from "#/server/db/data-contract";
import { auditLog, sessions, staffMembers, twoFactors, users } from "#/server/db/schema";
import { upsertReferenceData } from "#/server/data/reference";
import { PASSWORD, SECRET, makeAuth, post, sessionCookie, signInWithPassword } from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeStaff } from "#/test/factories";
import { totpNow } from "#/test/totp";

import { generateSeed } from "./generate.ts";
import { castEmail } from "./guard.ts";
import { SeedNotReady, seedCounts, seedDatabase } from "./write.ts";

// The integration project's test key (vite.config.ts)
const keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
const inbox = { local: "seed", domain: "example.com" };
const config = {
  inbox,
  password: PASSWORD,
  totpSecret: "k3Jd9xQ2mP7vL0aR5tY8wE1nB4cZ6hF2",
  authSecret: SECRET,
};
const opts = { config, keys, crowdSize: 30 };

const syntheticUsers = async () =>
  (await getOwnerDb().select({ n: count() }).from(users).where(eq(users.isSynthetic, true)))[0]!.n;
const auditRows = async () => (await getOwnerDb().select({ n: count() }).from(auditLog))[0]!.n;

async function freshDatabase({ reference = true } = {}) {
  await truncateAll();
  if (reference) await upsertReferenceData(getOwnerDb());
}

describe("a seeded database", () => {
  let first: Awaited<ReturnType<typeof seedDatabase>>;

  beforeAll(async () => {
    await freshDatabase();
    first = await seedDatabase(getOwnerDb(), opts);
  }, 120_000);

  it("seeds, and fills every copied table in the data contract", async () => {
    expect(first.action).toBe("seeded");
    for (const [table, contract] of Object.entries(dataContract)) {
      if (!contract.copied) continue;
      const { rows } = await getOwnerDb().execute<{ n: string }>(
        sql.raw(`select count(*) as n from "${table}"`),
      );
      expect(Number(rows[0]!.n), table).toBeGreaterThan(0);
    }
  });

  it("does nothing on a second run", async () => {
    const before = await seedCounts(getOwnerDb());
    const again = await seedDatabase(getOwnerDb(), opts);
    expect(again.action).toBe("already_seeded");
    expect(await seedCounts(getOwnerDb())).toEqual(before);
  });

  it("keeps the audit chain valid", async () => {
    expect(await verifyAuditChain(getOwnerDb().$client, keys)).toMatchObject({ ok: true });
  });

  it("hangs every customer off a synthetic user", async () => {
    const { rows } = await getOwnerDb().execute<{ n: string }>(
      sql`select count(*) as n from customers c join users u on u.id = c.user_id where not u.is_synthetic`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("lets the handler sign in with one of the printed backup codes", async () => {
    if (first.action !== "seeded") throw new Error("not seeded");
    const email = castEmail(inbox, "handler");
    const codes = first.backupCodes[email]!;
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(await getOwnerDb().select().from(twoFactors)).toHaveLength(2);

    const auth = makeAuth();
    const signIn = await signInWithPassword(auth, email);
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const verify = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: codes[0] },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
  });

  it("still says already seeded after the closure walkthrough scrubs cast users", async () => {
    // As 4.7's closeAccountRows leaves a closed user: is_synthetic stays, the rest is scrubbed
    await getOwnerDb()
      .update(users)
      .set({ email: sql`'closed+' || ${users.id} || '@closed.invalid'`, name: "Closed account" })
      .where(eq(users.email, castEmail(inbox, "closure-settled")));
    const before = await seedCounts(getOwnerDb());
    expect((await seedDatabase(getOwnerDb(), opts)).action).toBe("already_seeded");
    expect(await seedCounts(getOwnerDb())).toEqual(before);
  });

  it("lets a cast customer sign in with SEED_PASSWORD", async () => {
    const response = await signInWithPassword(makeAuth(), castEmail(inbox, "customer-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: expect.any(String) });
  });

  it("lets the handler sign in with a code from SEED_TOTP_SECRET", async () => {
    if (first.action !== "seeded") throw new Error("not seeded");
    const auth = makeAuth();
    const signIn = await signInWithPassword(auth, castEmail(inbox, "handler"));
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const secret = new URL(first.totpUri).searchParams.get("secret")!;
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret) },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    const { token } = (await verify.json()) as { token: string };
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
    expect(row!.twoFactorVerifiedAt).not.toBeNull();
  });
});

describe("seedDatabase on a database with history", () => {
  it("continues the staff codes and extends the existing audit chain", async () => {
    await freshDatabase();
    const existing = await makeStaff({ roles: ["admin"] });
    await getDb().transaction((tx) =>
      audit(tx, { actor: null, action: "staff.added", entityId: existing.userId }, keys),
    );

    await seedDatabase(getOwnerDb(), opts);

    const codes = (
      await getOwnerDb().select({ code: staffMembers.staffCode }).from(staffMembers)
    ).map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(3);
    expect(await verifyAuditChain(getOwnerDb().$client, keys)).toMatchObject({ ok: true });
  }, 120_000);
});

describe("seedDatabase failing", () => {
  it("leaves nothing behind when a row is refused", async () => {
    await freshDatabase();
    const auditBefore = await auditRows();
    const broken = (ctx: Parameters<typeof generateSeed>[0]) => {
      const plan = generateSeed(ctx);
      plan.claims[0]!.status = "nonsense";
      return plan;
    };
    await expect(seedDatabase(getOwnerDb(), { ...opts, generate: broken })).rejects.toThrow();
    expect(await syntheticUsers()).toBe(0);
    expect(await auditRows()).toBe(auditBefore);
  }, 120_000);

  it("asks for the reference data when it's missing", async () => {
    await freshDatabase({ reference: false });
    await expect(seedDatabase(getOwnerDb(), opts)).rejects.toBeInstanceOf(SeedNotReady);
    await expect(seedDatabase(getOwnerDb(), opts)).rejects.toThrow(
      "Reference data is missing: run vp run db:reference first",
    );
  });
});
