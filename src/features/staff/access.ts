import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { Actor } from "#/server/auth/actor";

// What the /staff route guard needs to know (4.5, 4.6). UX only: the data layer is the boundary.
// getActor reads the session with the cookie cache off, so a fresh stamp counts at once.

export type StaffAccess = "guest" | "customer" | "staff" | "needs_two_factor" | "needs_code";

/**
 * Staff with no roles hold no permission, so the staff area treats them as a customer. Staff need
 * 2FA on (frame 12) and a session that has given its code (frame 09) before they're let in (4.6,
 * call 14), matching what requirePermission refuses.
 */
export function staffAccessFor(actor: Actor | null): StaffAccess {
  if (!actor) return "guest";
  if (!actor.staff || actor.staff.permissions.size === 0) return "customer";
  if (!actor.twoFactor.enabled) return "needs_two_factor";
  if (actor.twoFactor.verifiedAt === null) return "needs_code";
  return "staff";
}

export const getStaffAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<StaffAccess> => {
    const { getActor } = await import("#/server/auth/actor");
    return staffAccessFor(await getActor(getRequestHeaders()));
  },
);
