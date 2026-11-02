import { sql } from "drizzle-orm";

import { getDb } from "#/server/db/client";

// Local Docker database from compose.yaml; CI sets TEST_DATABASE_URL to its service container.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/kerb_test";

// Empties every table in `public` between test cases (call it in beforeEach). The migrations table
// lives in the `drizzle` schema, so it's kept.
export async function truncateAll(): Promise<void> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}
