import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { WriteResult } from "#/lib/validation";
import { actorMiddleware } from "#/server/auth/middleware";
import type { PersonalDetails, RecentActivity } from "#/server/data/settings";

// Account settings' server functions (6.3). Server modules are imported inside the handlers so the
// database stays server-side.

export const getMyPersonalDetailsFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<PersonalDetails> => {
    const { getMyPersonalDetails } = await import("#/server/data/settings");
    return getMyPersonalDetails(context.actor, {});
  });

export const getMyRecentActivityFn = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<RecentActivity[]> => {
    const { getMyRecentActivity } = await import("#/server/data/settings");
    return getMyRecentActivity(context.actor, {});
  });

export interface UpdatePhoneEnvelope {
  input: { phone: string };
  idempotencyKey: string;
}

/** Adds, changes or clears the mobile (decision 4); one key per Save */
export const updateMyPhoneFn = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((data: UpdatePhoneEnvelope) => data)
  .handler(async ({ context, data }): Promise<WriteResult<{ phone: string | null }>> => {
    const { updateMyPhone } = await import("#/server/data/settings");
    return updateMyPhone(context.actor, data, { headers: getRequestHeaders() });
  });
