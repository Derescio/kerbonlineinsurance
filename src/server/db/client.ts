import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

let db: Db | undefined;

// One pool per function instance, created on first use. node-postgres everywhere, tests included
// (4.1, decision 1): with Fluid compute the instance and its pool are reused across requests, and
// attachDatabasePool closes idle connections before Vercel suspends it (a no-op off Vercel).
// DATABASE_URL is read here rather than in env.ts, so pages that never query don't need it; it
// moves into env.ts in 4.4.
export function getDb(): Db {
  if (db) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set: use Neon's pooled connection string (.env.example)");
  }
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5000 });
  attachDatabasePool(pool);
  db = drizzle({ client: pool, schema, casing: "snake_case" });
  return db;
}

// Ends the pool, so a script or test run can exit. The next getDb() opens a new one.
export async function closeDb(): Promise<void> {
  const current = db;
  db = undefined;
  await current?.$client.end();
}
