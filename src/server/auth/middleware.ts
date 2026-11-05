import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { getActor, requirePermission, requireUser, type Actor } from "./actor";
import type { Permission } from "./permissions";

// Server-function middleware (4.5): resolves the Actor from the session cookie and refuses the
// call before the handler runs. Both put `actor` on the context.
//
//   createServerFn({ method: "POST" })
//     .middleware([permissionMiddleware("claims.update")])
//     .handler(({ context }) => updateClaim(context.actor, ...));

/** Any signed-in user */
export const userMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const actor: Actor = requireUser(await getActor(getRequestHeaders()));
  return next({ context: { actor } });
});

/** Active staff holding `permission` */
export function permissionMiddleware(permission: Permission) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const actor: Actor = requirePermission(await getActor(getRequestHeaders()), permission);
    return next({ context: { actor } });
  });
}
