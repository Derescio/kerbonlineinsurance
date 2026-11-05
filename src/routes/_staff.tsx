import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getStaffAccess } from "#/features/staff/access";

// Pathless layout for the staff area. UX only: the data layer decides who can read what. 4.6 adds
// the 2FA gate here.
export const Route = createFileRoute("/_staff")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    const access = await getStaffAccess();
    if (access === "guest") throw redirect({ to: "/login", search: { redirect: location.href } });
    if (access === "customer") throw redirect({ to: "/account" });
  },
  component: Outlet,
});
