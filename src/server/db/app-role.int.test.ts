import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { getDb } from "#/server/db/client";

type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

const ALL: readonly Privilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

// An explicit entry for every public table: a new table fails the drift check until someone
// chooses its grants here (migration 0010 gives new tables all four by default).
const EXPECTED_GRANTS: Record<string, readonly Privilege[]> = {
  account_closures: ALL,
  accounts: ALL,
  audit_log: ["INSERT", "SELECT"],
  auth_rate_limits: ALL,
  bundles: ALL,
  businesses: ALL,
  claim_events: ALL,
  claim_messages: ALL,
  claim_settlements: ALL,
  claim_third_parties: ALL,
  claims: ALL,
  customers: ALL,
  deleted_rows: ALL,
  drivers: ALL,
  events: ALL,
  idempotency_keys: ALL,
  jobs: ALL,
  notifications: ALL,
  payments: ALL,
  policies: ALL,
  properties: ALL,
  quote_item_addons: ALL,
  quote_item_factors: ALL,
  quote_item_options: ALL,
  quote_items: ALL,
  quotes: ALL,
  rate_limits: ALL,
  rating_versions: ALL,
  reviews: ALL,
  security_events: ALL,
  sessions: ALL,
  staff_members: ALL,
  staff_roles: ALL,
  two_factors: ALL,
  underwriting_decisions: ALL,
  users: ALL,
  vehicles: ALL,
  verifications: ALL,
};

const INSUFFICIENT_PRIVILEGE = "42501";

class Rollback extends Error {}

// Runs one statement as kerb_app in its own transaction that always rolls back, so an unexpected
// success changes nothing. Resolves to the Postgres error, or undefined if it was accepted.
async function probe(statement: string): Promise<{ code?: string } | undefined> {
  try {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql.raw(statement));
      throw new Rollback();
    });
  } catch (error) {
    if (error instanceof Rollback) return undefined;
    // Drizzle wraps the driver's error; the Postgres fields are on its cause
    return ((error as { cause?: unknown }).cause ?? error) as { code?: string };
  }
  return undefined;
}

async function expectRefused(statement: string) {
  const error = await probe(statement);
  expect(error, `Postgres accepted: ${statement}`).toBeDefined();
  expect(error?.code, statement).toBe(INSUFFICIENT_PRIVILEGE);
}

const sorted = (values: readonly string[]) => [...values].sort();

async function publicTables(): Promise<string[]> {
  const { rows } = await getDb().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  return rows.map((row) => row.tablename);
}

describe("the kerb_app role", () => {
  it.each([
    "update audit_log set reason = reason where false",
    "delete from audit_log where false",
    "truncate audit_log",
    "drop trigger audit_log_append_only on audit_log",
    "alter table audit_log disable trigger audit_log_append_only",
    "create or replace function refuse_change() returns trigger language plpgsql as $$ begin return null; end $$",
    "set session_replication_role = replica",
    "create table kerb_app_probe (id int)",
    "select * from drizzle.__drizzle_migrations",
  ])("is refused: %s", async (statement) => {
    await expectRefused(statement);
  });

  it("refuses TRUNCATE on every table", async () => {
    const tables = await publicTables();
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) await expectRefused(`truncate "public"."${table}"`);
  });

  it("holds exactly the expected privileges (drift check)", async () => {
    const { rows } = await getDb().execute<{ table_name: string; privileges: string[] }>(sql`
      select table_name, array_agg(privilege_type::text order by privilege_type::text) as privileges
      from information_schema.role_table_grants
      where grantee = 'kerb_app' and table_schema = 'public'
      group by table_name
    `);
    const actual = Object.fromEntries(rows.map((row) => [row.table_name, sorted(row.privileges)]));
    const expected = Object.fromEntries(
      Object.entries(EXPECTED_GRANTS).map(([table, privileges]) => [table, sorted(privileges)]),
    );
    expect(actual).toEqual(expected);

    // Both directions: a table without an entry, or an entry without a table, fails
    expect(sorted(await publicTables())).toEqual(sorted(Object.keys(EXPECTED_GRANTS)));
  });

  it("has no role attributes or memberships", async () => {
    const { rows } = await getDb().execute<{
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolbypassrls: boolean;
      memberships: number;
      create_public: boolean;
      usage_drizzle: boolean;
      sequences_without_usage: number;
    }>(sql`
      select r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
        (select count(*)::int from pg_auth_members where member = 'kerb_app'::regrole) as memberships,
        has_schema_privilege('kerb_app', 'public', 'CREATE') as create_public,
        has_schema_privilege('kerb_app', 'drizzle', 'USAGE') as usage_drizzle,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'S'
            and not case when c.relkind = 'S' then has_sequence_privilege('kerb_app', c.oid, 'USAGE') end) as sequences_without_usage
      from pg_roles r where r.rolname = 'kerb_app'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      memberships: 0,
      create_public: false,
      usage_drizzle: false,
      sequences_without_usage: 0,
    });
  });
});
