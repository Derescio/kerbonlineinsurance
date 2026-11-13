import { sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";

import { Rejected } from "#/lib/validation";

import type { Db } from "./client";

// The only place that opens a transaction (a source scan in tx.test.ts enforces it), so every
// transaction gets the same limits: a statement over 10s is cancelled and a lock wait over 5s
// fails, instead of a stuck query or lock holding a pooled connection. set_config(..., true) is
// local to this transaction, so the pooled connection comes back clean. The isolation level stays
// READ COMMITTED, which audit() relies on for its chain read after the advisory lock. Taking a
// Db rather than a Tx means a transaction can't be nested inside another by accident.
//
// A run that returns a Rejected (a refusal decided mid-write) rolls back like a throw, and withTx
// resolves to that Rejected. Drizzle only rolls back on a throw, so a private sentinel carries the
// Rejected out of db.transaction; tx.rollback() would throw an error that can't carry it.

export const STATEMENT_TIMEOUT = "10s";
export const LOCK_TIMEOUT = "5s";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class RollBack {
  constructor(readonly rejection: Rejected) {}
}

export async function withTx<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true), set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`,
      );
      const result = await run(tx);
      if (result instanceof Rejected) throw new RollBack(result);
      return result;
    });
  } catch (error) {
    // T includes Rejected whenever run can return one
    if (error instanceof RollBack) return error.rejection as T;
    throw error;
  }
}

/** A Tx rather than a Db: a function given one runs inside it (5.6, saveQuote) */
export function isTx(db: Db | Tx): db is Tx {
  return db instanceof PgTransaction;
}

/**
 * A savepoint inside a transaction already open: a failure rolls back to it and leaves the outer
 * transaction usable, so a step can be retried in it (5.6: saveQuote's reference retry). The
 * outer transaction already has the timeouts.
 */
export function withSavepoint<T>(tx: Tx, run: (tx: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(run);
}
