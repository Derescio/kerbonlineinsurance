import { sql } from "drizzle-orm";

import type { Db } from "./client";

// The only place that opens a transaction (a source scan in tx.test.ts enforces it), so every
// transaction gets the same limits: a statement over 10s is cancelled and a lock wait over 5s
// fails, instead of a stuck query or lock holding a pooled connection. set_config(..., true) is
// local to this transaction, so the pooled connection comes back clean. The isolation level stays
// READ COMMITTED, which audit() relies on for its chain read after the advisory lock. Taking a
// Db rather than a Tx means a transaction can't be nested inside another by accident.

export const STATEMENT_TIMEOUT = "10s";
export const LOCK_TIMEOUT = "5s";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function withTx<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true), set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`,
    );
    return run(tx);
  });
}
