import type { z } from "zod";

import { requirePermission, requireUser, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import type { Permission } from "#/server/auth/permissions";
import { getDb, type Db } from "#/server/db/client";

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
