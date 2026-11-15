// Idempotent writes (plan/phases/04-data-auth/05c-safe-write-tools.md, call 13): a double tap or
// a browser retry with the same key gets the first answer back instead of writing twice.
//
// - The key row is claimed inside the write's own transaction, so it commits with the write. A
//   run that throws or returns a Rejected rolls the row back too, and a retry runs fresh. No row
//   with a null response is ever committed.
// - The claim is INSERT … ON CONFLICT DO UPDATE … WHERE expired, not a plain INSERT: a plain
//   INSERT's unique violation aborts the transaction, so the stored response could no longer be
//   read in it. An expired row (older than 24 hours) counts as absent and is replaced in place.
// - A second request with the same key waits on the first's uncommitted row (bounded by withTx's
//   lock_timeout). Once the first commits, nothing is returned, and a fresh SELECT (READ COMMITTED
//   takes a new snapshot per statement) reads the committed row and its response.
// - A user deleted while the claim waited on their row (a delete's FOR UPDATE) fails the claim's
//   foreign key; that comes out as UNAUTHENTICATED, as deleteAccount's own second request does,
//   not a raw database error (5.6: a purchase racing a delete).
// - Only a hash of the request is stored. Responses are stored as they are, so they should hold
//   ids and statuses only, never personal data.
import { createHash } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import { Rejected } from "#/lib/validation";
import { canonicalJson, type JsonValue } from "#/server/audit/chain";
import { AuthzError, IdempotencyConflictError } from "#/server/auth/errors";

import type { Db } from "./client";
import { idempotencyKeys } from "./schema";
import { withTx, type Tx } from "./tx";

export type { JsonValue };

export interface IdempotencyInput {
  userId: string;
  key: string;
  action: string;
  payload: unknown;
}

const expiresAt = () => sql`now() + interval '24 hours'`;

/** The value as the browser's JSON would see it: a Date becomes its ISO string, undefined goes. */
export function toJson(value: unknown): JsonValue {
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as JsonValue);
}

/** SHA-256 hex of the canonical action and payload, so key order doesn't matter. */
export function requestHash(action: string, payload: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ action, payload: toJson(payload) }))
    .digest("hex");
}

const FOREIGN_KEY_VIOLATION = "23503";

function isUserGone(error: unknown): boolean {
  const pg = ((error as { cause?: unknown }).cause ?? error) as {
    code?: string;
    constraint?: string;
  };
  return (
    pg.code === FOREIGN_KEY_VIOLATION && pg.constraint === "idempotency_keys_user_id_users_id_fk"
  );
}

/** The read-only replay lookup: an unexpired row's response, a conflict, or null. */
export async function findReplay(
  db: Db,
  input: IdempotencyInput,
): Promise<{ response: JsonValue } | null> {
  const [row] = await db
    .select({ requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, input.userId),
        eq(idempotencyKeys.key, input.key),
        gt(idempotencyKeys.expiresAt, sql`now()`),
      ),
    );
  if (!row) return null;
  if (row.requestHash !== requestHash(input.action, input.payload)) {
    throw new IdempotencyConflictError();
  }
  return { response: row.response as JsonValue };
}

export function withIdempotency<T extends JsonValue>(
  db: Db,
  input: IdempotencyInput,
  run: (tx: Tx) => Promise<T | Rejected>,
): Promise<T | Rejected> {
  const hash = requestHash(input.action, input.payload);
  const thisKey = and(eq(idempotencyKeys.userId, input.userId), eq(idempotencyKeys.key, input.key));
  return withTx(db, async (tx) => {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ userId: input.userId, key: input.key, requestHash: hash, expiresAt: expiresAt() })
      .onConflictDoUpdate({
        target: [idempotencyKeys.userId, idempotencyKeys.key],
        set: { requestHash: hash, response: null, createdAt: sql`now()`, expiresAt: expiresAt() },
        setWhere: sql`${idempotencyKeys.expiresAt} <= now()`,
      })
      .returning({ key: idempotencyKeys.key })
      .catch((error: unknown) => {
        throw isUserGone(error) ? new AuthzError("UNAUTHENTICATED") : error;
      });

    if (claimed.length === 0) {
      // Another request committed this key first
      const [row] = await tx
        .select({ requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response })
        .from(idempotencyKeys)
        .where(thisKey);
      if (!row) throw new Error("idempotency key row vanished after a conflict");
      if (row.requestHash !== hash) throw new IdempotencyConflictError();
      return row.response as T;
    }

    const result = await run(tx);
    if (result instanceof Rejected) return result;
    const response = toJson(result);
    await tx.update(idempotencyKeys).set({ response }).where(thisKey);
    return response as T;
  });
}
