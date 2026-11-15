import { createServerFn } from "@tanstack/react-start";

import { actorMiddleware } from "#/server/auth/middleware";
import type { PolicyListItem } from "#/server/data/policies";

// The account page's "Your policies" (5.6, decision 12), until 6.1's dashboard replaces it.
// Server modules are imported inside the handler so the database stays server-side.
export const listMyPoliciesFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<PolicyListItem[]> => {
    const { listMyPolicies } = await import("#/server/data/policies");
    return listMyPolicies(context.actor, {});
  });
