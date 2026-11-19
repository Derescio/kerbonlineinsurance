import { createMiddleware } from "@tanstack/react-start";
import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";

import { getActor, requirePermission, requireUser, type Actor } from "./actor";
import {
  AuthzError,
  IdempotencyConflictError,
  logSafeError,
  publicErrorFor,
  RateLimitError,
} from "./errors";
import type { Permission } from "./permissions";
import { actorForRequest } from "./request-actor";

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

/** The request's actor, read once however many server functions the request calls (6.1) */
function requestActor(): Promise<Actor | null> {
  return actorForRequest(getRequest(), () => getActor(getRequestHeaders()));
}

/** Any signed-in user */
export const userMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const actor: Actor = requireUser(await requestActor());
    return await next({ context: { actor } });
  } catch (error) {
    return fail(error);
  }
});

/** Anyone, signed in or not: `actor` is null when signed out */
export const actorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const actor: Actor | null = await requestActor();
    return await next({ context: { actor } });
  } catch (error) {
    return fail(error);
  }
});

/** Active staff holding `permission` */
export function permissionMiddleware(permission: Permission) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    try {
      const actor: Actor = requirePermission(await requestActor(), permission);
      return await next({ context: { actor } });
    } catch (error) {
      return fail(error);
    }
  });
}

/** Anyone, with no session lookup: for guest calls such as quote.started (5.1, plan P3) */
export const publicMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    return fail(error);
  }
});
