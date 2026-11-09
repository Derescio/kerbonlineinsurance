import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Db } from "#/server/db/client";
import * as schema from "#/server/db/schema";

// Local Docker database from compose.yaml; CI sets TEST_DATABASE_URL to its service container.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/kerb_test";

let ownerDb: Db | undefined;

// A connection as the database owner, for what the app role can't do: emptying tables and setting
// rows up or breaking them on purpose. The tests themselves run as kerb_app (getDb()). The pool
// lets the process exit when idle, so test files needn't close it.
export function getOwnerDb(): Db {
  if (ownerDb) return ownerDb;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2, allowExitOnIdle: true });
  ownerDb = drizzle({ client: pool, schema, casing: "snake_case" });
  return ownerDb;
}

// Empties every table in `public` between test cases (call it in beforeEach). The migrations table
// lives in the `drizzle` schema, so it's kept.
export async function truncateAll(): Promise<void> {
  const db = getOwnerDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}

// Runs one statement as the owner with triggers and foreign keys skipped (replica mode), to
// simulate tampering that the app role, the triggers and the constraints would all refuse.
export async function tamper(statement: string, values: unknown[] = []): Promise<void> {
  const client = await getOwnerDb().$client.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(statement, values);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
