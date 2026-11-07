import { z } from "zod";

import {
  CHECK_FIELDS,
  parseInput,
  Rejected,
  type ValidationFailure,
  type WriteResult,
} from "#/lib/validation";
import type { JsonValue } from "#/server/audit/chain";
import { requirePermission, requireUser, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import type { Permission } from "#/server/auth/permissions";
import { getDb, type Db } from "#/server/db/client";
import { findReplay, withIdempotency } from "#/server/db/idempotency";
import { limit, rateLimitSubject, type RateRule } from "#/server/db/rate-limit";
import { withTx, type Tx } from "#/server/db/tx";

export { rejected, Rejected } from "#/lib/validation";

// How every protected read is declared (4.5). Declaring the access on the function lets the
// permission suite read it back and attack each read as every kind of user.

export type Access = "signed_in" | Permission;

export interface DataRead<I, O> {
  (actor: Actor | null, input: I): Promise<O>;
  access: Access;
}

/**
 * Checks access first, then the input. A malformed id is a missing record, so any zod failure is
 * NOT_FOUND and the browser can't tell the two apart. `I` is what callers pass (defaults optional),
 * `P` what `run` receives once parsed.
 */
export function defineRead<I, P, O>(
  access: Access,
  input: z.ZodType<P, I>,
  run: (actor: Actor, input: P, db: Db) => Promise<O>,
): DataRead<I, O> {
  const read = async (actor: Actor | null, raw: I): Promise<O> => {
    const known = access === "signed_in" ? requireUser(actor) : requirePermission(actor, access);
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw new AuthzError("NOT_FOUND");
    return run(known, parsed.data, getDb());
  };
  return Object.assign(read, { access });
}

export interface WriteOptions {
  limit?: { action: string; rule: RateRule };
  idempotent?: { action: string };
  /**
   * A check that runs after the limit and before the transaction, given the raw envelope: a
   * failure ends the write without running it. A replay never reaches it. Used for the proof of
   * identity before an account closure (4.7), so every wrong password is counted by the limit.
   */
  before?: (
    actor: Actor,
    raw: WriteEnvelope,
    ctx: { headers: Headers },
  ) => Promise<ValidationFailure | null>;
}

export interface WriteEnvelope {
  input: unknown;
  idempotencyKey?: unknown;
}

export interface DataWrite<O> {
  (actor: Actor | null, raw: WriteEnvelope, ctx: { headers: Headers }): Promise<WriteResult<O>>;
  access: "signed_in";
  kind: "write";
}

const keySchema = z.object({ idempotencyKey: z.uuid() });

/**
 * How every protected write is declared (4.5c, call 10): access, then validation (input and key
 * together), then the replay lookup, then the rate limit, then `before`, then the transaction. A
 * replay comes before the limit so a retry of a committed write is never refused. A `Rejected`
 * from `run` rolls the transaction back and comes out as a failure; anything thrown is left for
 * the server function's middleware to convert.
 */
export function defineWrite<P, O extends JsonValue>(
  input: z.ZodType<P>,
  options: WriteOptions,
  run: (actor: Actor, data: P, tx: Tx) => Promise<O | Rejected>,
): DataWrite<O> {
  const write = async (
    actor: Actor | null,
    raw: WriteEnvelope,
    ctx: { headers: Headers },
  ): Promise<WriteResult<O>> => {
    const known = requireUser(actor);

    const parsed = parseInput(input, raw?.input);
    const keyed = options.idempotent
      ? parseInput(keySchema, { idempotencyKey: raw?.idempotencyKey })
      : null;
    if (!parsed.ok || (keyed && !keyed.ok)) {
      const failures = [parsed, keyed].flatMap((r) => (r && !r.ok ? [r.error] : []));
      const error: ValidationFailure = {
        code: "VALIDATION",
        message: parsed.ok ? CHECK_FIELDS : parsed.error.message,
        fields: Object.assign({}, ...failures.map((f) => f.fields)),
      };
      return { ok: false, error };
    }

    const idempotency =
      options.idempotent && keyed?.ok
        ? {
            userId: known.userId,
            key: keyed.data.idempotencyKey,
            action: options.idempotent.action,
            payload: parsed.data,
          }
        : null;

    if (idempotency) {
      const replay = await findReplay(getDb(), idempotency);
      if (replay) return { ok: true, data: replay.response as O };
    }

    if (options.limit) {
      const subject = await rateLimitSubject(actor, ctx.headers);
      await limit(`${options.limit.action}:${subject}`, options.limit.rule);
    }

    if (options.before) {
      const failure = await options.before(known, raw, ctx);
      if (failure) return { ok: false, error: failure };
    }

    const result = idempotency
      ? await withIdempotency<O>(getDb(), idempotency, (tx) => run(known, parsed.data, tx))
      : await withTx(getDb(), (tx) => run(known, parsed.data, tx));
    if (result instanceof Rejected) return { ok: false, error: result.error };
    return { ok: true, data: result };
  };
  return Object.assign(write, { access: "signed_in" as const, kind: "write" as const });
}
