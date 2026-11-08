import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { TEST_DATABASE_URL } from "#/test/db";

import { emptyDatabase } from "./reset-dev-core.ts";

// On a database of its own, so the shared test database keeps its schema for the other files
const name = `kerb_reset_${randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
let client: pg.Client;

async function tables(schema: string): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = $1",
    [schema],
  );
  return rows.map((r) => r.tablename);
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
}, 60_000);

afterAll(async () => {
  await client?.end();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

describe("emptyDatabase", () => {
  it("leaves an empty public schema and no migrations table", async () => {
    await client.query(
      "insert into users (id, name, email) values ('u1', 'Left over', 'left@example.test')",
    );
    await emptyDatabase(client);
    expect(await tables("public")).toEqual([]);
    const { rows } = await client.query("select 1 from pg_namespace where nspname = 'drizzle'");
    expect(rows).toHaveLength(0);
  });

  it("lets every migration run again with kerb_app already there, grants included", async () => {
    await emptyDatabase(client);
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    expect(await tables("public")).toContain("users");
    const { rows } = await client.query<{ ok: boolean }>(
      "select has_table_privilege('kerb_app', 'users', 'INSERT') as ok",
    );
    expect(rows[0]!.ok).toBe(true);
    const audit = await client.query<{ ok: boolean }>(
      "select has_table_privilege('kerb_app', 'audit_log', 'UPDATE') as ok",
    );
    expect(audit.rows[0]!.ok).toBe(false);
  }, 60_000);
});
