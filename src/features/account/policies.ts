import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { AuthzError } from "#/server/auth/errors";
import { actorMiddleware } from "#/server/auth/middleware";
import type { AccountCustomer } from "#/server/data/multi-policy";
import type { NextPayment, PolicyDetail, PolicyListItem } from "#/server/data/policies";

// The account's reads (6.1, 6.2): the customer's policies, their next payment and one policy.
// Server modules are imported inside the handler so the database stays server-side.
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

/** One policy by reference (6.2, decision 1). Someone else's, or a missing one, is the not-found page */
export const getMyPolicyFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .validator((input: { reference: string }) => ({ reference: String(input?.reference ?? "") }))
  .handler(async ({ context, data }): Promise<PolicyDetail> => {
    const { getMyPolicy } = await import("#/server/data/policies");
    try {
      return await getMyPolicy(context.actor, data);
    } catch (error) {
      if (error instanceof AuthzError && error.code === "NOT_FOUND") throw notFound();
      throw error;
    }
  });
