import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { Actor } from "#/server/auth/actor";

// What the /staff route guard needs to know (4.5). UX only: the data layer is the boundary.

export type StaffAccess = "guest" | "customer" | "staff";

/** Staff with no roles hold no permission, so the staff area treats them as a customer */
export function staffAccessFor(actor: Actor | null): StaffAccess {
  if (!actor) return "guest";
  return actor.staff && actor.staff.permissions.size > 0 ? "staff" : "customer";
}

export const getStaffAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<StaffAccess> => {
    const { getActor } = await import("#/server/auth/actor");
    return staffAccessFor(await getActor(getRequestHeaders()));
  },
);
