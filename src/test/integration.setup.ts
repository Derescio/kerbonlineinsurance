import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { emptyDatabase } from "../../scripts/reset-dev-core.ts";

import { TEST_DATABASE_URL } from "./db";

// Global setup for the `integration` project: every run starts from an empty database with all
// committed migrations applied (plan/engineering.md section 4), locally and in CI alike.
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    // A refused connection is an AggregateError with an empty message; its code says what happened
    const { code, message } = error as { code?: string; message?: string };
    const reason = code ?? message ?? String(error);
    throw new Error(
      `Integration tests need the test database at ${new URL(TEST_DATABASE_URL).host} (${reason}).\n` +
        "Start Docker Desktop, then run: vp run db:test:up",
    );
  }
  try {
    // The same reset as `vp run db:reset-dev` (plan/dev-database.md), so that path runs every time
    await emptyDatabase(client);
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    // The migration creates kerb_app without LOGIN (each Neon branch sets its password by hand).
    // The password is public on purpose: the role exists only in the Docker and CI test databases.
    await client.query("alter role kerb_app with login password 'kerb_app'");
  } finally {
    await client.end();
  }
}
