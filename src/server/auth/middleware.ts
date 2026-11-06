import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { getActor, requirePermission, requireUser, type Actor } from "./actor";
import {
  AuthzError,
  IdempotencyConflictError,
  logSafeError,
  publicErrorFor,
  RateLimitError,
} from "./errors";
import type { Permission } from "./permissions";

// Server-function middleware (4.5): resolves the Actor from the session cookie and refuses the
// call before the handler runs. Both put `actor` on the context. Any other failure is logged
// here and replaced by a fixed sentence, because TanStack sends `error.message` to the browser.
//
//   createServerFn({ method: "POST" })
//     .middleware([permissionMiddleware("claims.update")])
//     .handler(({ context }) => updateClaim(context.actor, ...));

/** Log without personal data (no email, no URL), then throw what the browser may see */
function fail(error: unknown): never {
  const out = publicErrorFor(error);
  if (out !== error) {
    if (error instanceof AuthzError) console.error(`[authz] ${error.code}`);
    // limit() logs its own refusal, and a conflict is a user outcome
    else if (error instanceof RateLimitError || error instanceof IdempotencyConflictError) {
      // not logged here
    } else console.error("[server fn]", logSafeError(error));
  }
  throw out;
}

/** Any signed-in user */
export const userMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const actor: Actor = requireUser(await getActor(getRequestHeaders()));
    return await next({ context: { actor } });
  } catch (error) {
    return fail(error);
  }
});

/** Anyone, signed in or not: `actor` is null when signed out */
export const actorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const actor: Actor | null = await getActor(getRequestHeaders());
    return await next({ context: { actor } });
  } catch (error) {
    return fail(error);
  }
});

/** Active staff holding `permission` */
export function permissionMiddleware(permission: Permission) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    try {
      const actor: Actor = requirePermission(await getActor(getRequestHeaders()), permission);
      return await next({ context: { actor } });
    } catch (error) {
      return fail(error);
    }
  });
}
