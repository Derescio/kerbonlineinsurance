import { randomBytes, randomUUID } from "node:crypto";

import { desc, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";

import { AUDIT_ACTIONS } from "#/server/audit/actions";
import {
  AUDIT_LOCK_KEY,
  assertChainable,
  computeHash,
  nextCreatedAt,
  type AuditKeys,
  type ChainRow,
} from "#/server/audit/chain";
import {
  clearReferenceCaches,
  getActiveRatingVersion,
  getCatalogue,
} from "#/server/data/reference";
import type { Db } from "#/server/db/client";
import * as schema from "#/server/db/schema";
import { products } from "#/server/db/schema/values";
import { RATING_SOURCES } from "#/server/reference/rating/index";

import { generateSeed } from "./generate.ts";
import type { SeedConfig } from "./guard.ts";
import { Rng, SEED, SEED_FROM } from "./random.ts";
import type { SeedContext, SeedPlan } from "./types.ts";

// Writes a generated seed to the database as the owner (4.9, calls 11, 14, 15): all of it in one
// transaction, or nothing. A database that already has synthetic users is left alone. Staff rows,
// sign-in methods and two-factor rows are made here, and the audit rows are chained onto the
// existing log with the same functions as audit() and auth:make-admin, stamped now.

export type SeedResult =
  | { action: "already_seeded"; counts: Record<string, number> }
  | { action: "seeded"; counts: Record<string, number>; totpUri: string };

export class SeedNotReady extends Error {
  constructor() {
    super("Reference data is missing: run vp run db:reference first");
    this.name = "SeedNotReady";
  }
}

export interface SeedOptions {
  config: Pick<SeedConfig, "inbox" | "password" | "totpSecret" | "authSecret">;
  keys: AuditKeys;
  crowdSize: number;
  /** When the audit rows are stamped; defaults to now */
  now?: Date;
  /** Tests swap in a broken plan */
  generate?: (ctx: SeedContext) => SeedPlan;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// In foreign-key order. Staff rows go in before these (claims and decisions point at them).
const TABLES: readonly (readonly [Exclude<keyof SeedPlan, "users" | "audit">, PgTable])[] = [
  ["customers", schema.customers],
  ["quotes", schema.quotes],
  ["quoteItems", schema.quoteItems],
  ["quoteItemOptions", schema.quoteItemOptions],
  ["quoteItemAddons", schema.quoteItemAddons],
  ["quoteItemFactors", schema.quoteItemFactors],
  ["underwritingDecisions", schema.underwritingDecisions],
  ["vehicles", schema.vehicles],
  ["drivers", schema.drivers],
  ["properties", schema.properties],
  ["businesses", schema.businesses],
  ["bundles", schema.bundles],
  ["policies", schema.policies],
  ["payments", schema.payments],
  ["claims", schema.claims],
  ["claimEvents", schema.claimEvents],
  ["claimThirdParties", schema.claimThirdParties],
  ["claimMessages", schema.claimMessages],
  ["claimSettlements", schema.claimSettlements],
  ["reviews", schema.reviews],
  ["notifications", schema.notifications],
  ["events", schema.events],
  ["accountClosures", schema.accountClosures],
];

const CHUNK = 500;

export async function seedCounts(db: Db | Tx): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const synthetic = await db.execute<{ n: string }>(
    sql`select count(*) as n from users where is_synthetic`,
  );
  counts.syntheticUsers = Number(synthetic.rows[0]!.n);
  for (const name of ["staff_members", "accounts", "two_factors", "audit_log"] as const) {
    const { rows } = await db.execute<{ n: string }>(sql.raw(`select count(*) as n from ${name}`));
    counts[name] = Number(rows[0]!.n);
  }
  for (const [, table] of TABLES) {
    const name = getTableName(table);
    const { rows } = await db.execute<{ n: string }>(
      sql.raw(`select count(*) as n from "${name}"`),
    );
    counts[name] = Number(rows[0]!.n);
  }
  return counts;
}

async function loadContext(tx: Tx, opts: SeedOptions): Promise<SeedContext> {
  // The module caches belong to whichever database was read last; the seed reads afresh
  clearReferenceCaches();
  const db = tx as unknown as Db;
  const catalogue = await getCatalogue(db);
  const versions = {} as SeedContext["versions"];
  for (const product of products) {
    const active = await getActiveRatingVersion(db, product);
    const source = RATING_SOURCES.find(
      (s) => s.product === product && s.version === active?.version,
    );
    if (!active || !source) throw new SeedNotReady();
    versions[product] = { id: active.id, source };
  }
  if (catalogue.length === 0) throw new SeedNotReady();
  return { catalogue, versions, inbox: opts.config.inbox, crowdSize: opts.crowdSize };
}

/** Rows without an updatedAt take their createdAt, so nothing is stamped with today */
function withUpdatedAt(table: PgTable, rows: readonly Record<string, unknown>[]) {
  if (!("updatedAt" in getTableColumns(table))) return rows;
  return rows.map((row) => (row.updatedAt ? row : { ...row, updatedAt: row.createdAt }));
}

async function insertAll(tx: Tx, table: PgTable, rows: readonly Record<string, unknown>[]) {
  const ready = withUpdatedAt(table, rows);
  for (let i = 0; i < ready.length; i += CHUNK) {
    await tx.insert(table).values(ready.slice(i, i + CHUNK) as never);
  }
}

export async function seedDatabase(db: Db, opts: SeedOptions): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const generate = opts.generate ?? generateSeed;
  // Hashed before the transaction opens: scrypt is slow and needs no database
  const castHash = await hashPassword(opts.config.password);
  // The crowd can't sign in: one hash of a password nobody knows
  const crowdHash = await hashPassword(randomBytes(32).toString("base64url"));
  const encryptedSecret = await symmetricEncrypt({
    key: opts.config.authSecret,
    data: opts.config.totpSecret,
  });

  return db.transaction(async (tx) => {
    const seeded = await tx.execute<{ yes: boolean }>(
      sql`select exists (select 1 from users where is_synthetic) as yes`,
    );
    if (seeded.rows[0]!.yes) return { action: "already_seeded", counts: await seedCounts(tx) };

    const ctx = await loadContext(tx, opts);
    const plan = generate(ctx);

    // Users and how they sign in
    await insertAll(
      tx,
      schema.users,
      plan.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: !u.scrubbed,
        twoFactorEnabled: u.staff !== null,
        isSynthetic: true,
        termsAcceptedAt: u.createdAt,
        createdAt: u.createdAt,
      })),
    );
    await insertAll(
      tx,
      schema.accounts,
      plan.users
        .filter((u) => !u.scrubbed)
        .map((u) => ({
          id: randomUUID(),
          accountId: u.id,
          providerId: "credential",
          userId: u.id,
          password: u.cast ? castHash : crowdHash,
          createdAt: u.createdAt,
        })),
    );

    // Staff: codes carry on from whatever dev already has (as auth:make-admin does)
    const staff = plan.users.filter((u) => u.staff);
    const next = await tx.execute<{ n: number }>(
      sql`select coalesce(max(substring(staff_code from 3)::int), 0) as n from staff_members`,
    );
    let code = Number(next.rows[0]!.n);
    const codeRng = new Rng(SEED).fork("backup-codes");
    for (const u of staff) {
      await tx.insert(schema.staffMembers).values({
        userId: u.id,
        displayName: u.staff!.displayName,
        staffCode: `H-${String(++code).padStart(3, "0")}`,
        startedAt: SEED_FROM,
        createdAt: u.createdAt,
        updatedAt: u.createdAt,
      });
      await tx
        .insert(schema.staffRoles)
        .values(u.staff!.roles.map((role) => ({ userId: u.id, role, grantedAt: SEED_FROM })));
      await tx.insert(schema.twoFactors).values({
        id: randomUUID(),
        userId: u.id,
        secret: encryptedSecret,
        // Plain JSON: Kerb's twoFactor() has no storeBackupCodes option, so that's how it reads them
        backupCodes: JSON.stringify(backupCodes(codeRng)),
        verified: true,
      });
    }

    // Everything else; selected options are set once the options exist (the two point at each other)
    for (const [key, table] of TABLES) {
      const rows = plan[key] as readonly Record<string, unknown>[];
      if (key === "quoteItems") {
        await insertAll(
          tx,
          table,
          rows.map((r) => ({ ...r, selectedOptionId: null })),
        );
      } else {
        await insertAll(tx, table, rows);
      }
      if (key === "quoteItemOptions") await selectOptions(tx, plan);
    }

    await writeAudit(tx, plan, staff, opts.keys, now);

    const handler = plan.users.find((u) => u.cast === "handler")!;
    return {
      action: "seeded",
      counts: await seedCounts(tx),
      totpUri: `otpauth://totp/Kerb:${encodeURIComponent(handler.email)}?secret=${base32(opts.config.totpSecret)}&issuer=Kerb`,
    };
  });
}

async function selectOptions(tx: Tx, plan: SeedPlan) {
  const pairs = plan.quoteItems
    .filter((i) => i.selectedOptionId)
    .map((i) => ({ id: i.id, opt: i.selectedOptionId }));
  for (let i = 0; i < pairs.length; i += CHUNK) {
    await tx.execute(sql`
      update quote_items q set selected_option_id = s.opt
        from json_to_recordset(${JSON.stringify(pairs.slice(i, i + CHUNK))}::json) as s(id uuid, opt uuid)
       where q.id = s.id`);
  }
}

async function writeAudit(
  tx: Tx,
  plan: SeedPlan,
  staff: SeedPlan["users"],
  keys: AuditKeys,
  now: Date,
) {
  const key = keys.keys.get(keys.activeVersion);
  if (!key) throw new Error(`Audit key version ${keys.activeVersion} is not loaded`);
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)`);
  const [latest] = await tx
    .select({ hash: schema.auditLog.hash, createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.id))
    .limit(1);

  const entries = [
    ...staff.map((u) => ({
      action: "staff.added" as const,
      entityId: u.id,
      actorUserId: null,
      actorRole: null,
      changes: { roles: [...u.staff!.roles] },
    })),
    ...plan.audit,
  ];
  let prevHash = latest?.hash ?? null;
  let prevAt = latest?.createdAt ?? null;
  const rows = entries.map((entry) => {
    const row: ChainRow = {
      prevHash,
      keyVersion: keys.activeVersion,
      createdAt: nextCreatedAt(prevAt, now),
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: AUDIT_ACTIONS[entry.action].entityType,
      entityId: entry.entityId,
      changes: entry.changes ?? null,
      reason: null,
      requestId: null,
      ipHash: null,
    };
    assertChainable(row);
    const hash = computeHash(row, key);
    prevHash = hash;
    prevAt = row.createdAt;
    return { ...row, hash };
  });
  // One row per statement: the chain is read back in id order, so ids must follow this order
  for (const row of rows) await tx.insert(schema.auditLog).values(row);
}

/** Ten XXXXX-XXXXX codes, the form Kerb's twoFactor() makes (capitals and digits) */
function backupCodes(rng: Rng): string[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 10 }, () => {
    const code = Array.from({ length: 10 }, () => rng.pick(chars.split(""))).join("");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** RFC 4648 base32 of the secret's UTF-8 bytes, as Better Auth's otpauth:// URI carries it */
function base32(text: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
