import type pg from "pg";

// Empties a database back to nothing, so every migration can run again from the start (the reseed
// workflow, plan/dev-database.md). The integration test setup does the same before each run, so
// this path runs many times a day. Kept here, beside the guarded `db:reset-dev` script, and never
// imported by app code: only that script and the test setup call it.

/** True only when `argv` holds `--confirm <host>` (or `--confirm=<host>`) naming exactly this host */
export function confirmedHost(host: string, argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === `--confirm=${host}`) return true;
    if (arg === "--confirm" && argv[i + 1] === host) return true;
  }
  return false;
}

/**
 * Drops the app's schema and the migrations table, leaving an empty `public`. Roles survive (they
 * belong to the server, not the database): kerb_app keeps its password, and migration 0010 grants
 * it again. One transaction, so a failure leaves the database as it was.
 */
export async function emptyDatabase(client: pg.ClientBase): Promise<void> {
  await client.query("begin");
  try {
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
