import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { WriteResult } from "#/lib/validation";
import { actorMiddleware } from "#/server/auth/middleware";
import type { ConfirmChangeResult, PriceChangeResult } from "#/server/policy-changes/writes";

// Policy changes' server functions (6.3b). Server modules are imported inside the handlers so the
// database stays server-side.

export interface PriceChangeEnvelope {
  input: { reference: string; change: unknown };
}

export interface ChangeIdEnvelope {
  input: { changeId: string };
  idempotencyKey?: string;
}

/** Prices a change as the dialog's form fills in; writes the priced row Confirm sends back */
export const priceMyPolicyChangeFn = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((data: PriceChangeEnvelope) => data)
  .handler(async ({ context, data }): Promise<WriteResult<PriceChangeResult>> => {
    const { priceMyPolicyChange } = await import("#/server/policy-changes/writes");
    return priceMyPolicyChange(context.actor, data, { headers: getRequestHeaders() });
  });

/** Confirms a priced change; one idempotency key per press */
export const confirmMyPolicyChangeFn = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((data: ChangeIdEnvelope) => data)
  .handler(async ({ context, data }): Promise<WriteResult<ConfirmChangeResult>> => {
    const { confirmMyPolicyChange } = await import("#/server/policy-changes/writes");
    return confirmMyPolicyChange(context.actor, data, { headers: getRequestHeaders() });
  });

/** Drops a priced change, or one waiting for its top-up (its session is expired) */
export const abandonMyPolicyChangeFn = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((data: ChangeIdEnvelope) => data)
  .handler(async ({ context, data }): Promise<WriteResult<{ status: "abandoned" }>> => {
    const { abandonMyPolicyChange } = await import("#/server/policy-changes/writes");
    return abandonMyPolicyChange(context.actor, data, { headers: getRequestHeaders() });
  });

/** Back on the policy page with a top-up waiting: applies it if Stripe has it paid */
export const checkMyTopUpFn = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((data: { changeId: string }) => data)
  .handler(async ({ context, data }): Promise<{ status: string }> => {
    const { checkMyTopUp } = await import("#/server/policy-changes/writes");
    return checkMyTopUp(context.actor, data);
  });
