import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { accountTwoFactorHref, twoFactorChallengeHref } from "#/features/auth/guard";
import { getStaffAccess } from "#/features/staff/access";

// Pathless layout for the staff area. UX only: the data layer decides who can read what. Staff need
// 2FA on (frame 12, on /account/two-factor) and a session that has given its code (frame 09) (4.6,
// call 14). Those two pages come in Task 9 and aren't in the route tree yet, hence `href`.
export const Route = createFileRoute("/_staff")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    const access = await getStaffAccess();
    if (access === "guest") throw redirect({ to: "/login", search: { redirect: location.href } });
    if (access === "customer") throw redirect({ to: "/account" });
    if (access === "needs_two_factor")
      throw redirect({ href: accountTwoFactorHref(location.href) });
    if (access === "needs_code") throw redirect({ href: twoFactorChallengeHref(location.href) });
  },
  component: Outlet,
});
