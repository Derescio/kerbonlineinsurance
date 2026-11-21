import { createServerFn } from "@tanstack/react-start";

import { actorMiddleware } from "#/server/auth/middleware";
import type { AccountCustomer } from "#/server/data/multi-policy";
import type { NextPayment, PolicyListItem } from "#/server/data/policies";

// The Overview's reads (6.1): the customer's policies, and their next payment. Server modules are
// imported inside the handler so the database stays server-side.
export const listMyPoliciesFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<PolicyListItem[]> => {
    const { listMyPolicies } = await import("#/server/data/policies");
    return listMyPolicies(context.actor, {});
  });

export const getMyAddProductsFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{ customer: AccountCustomer | null; rates: { car: number; home: number } }> => {
      const { getMyAddProducts } = await import("#/server/data/multi-policy");
      return getMyAddProducts(context.actor, {});
    },
  );

export const getMyNextPaymentFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<NextPayment> => {
    const { getMyNextPayment } = await import("#/server/data/policies");
    return getMyNextPayment(context.actor, {});
  });
