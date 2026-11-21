import { createFileRoute, redirect } from "@tanstack/react-router";

import { AccountShell } from "#/features/account/AccountShell";
import { PoliciesPage } from "#/features/account/PoliciesPage";
import { listMyPoliciesFn } from "#/features/account/policies";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";
import { todayIso } from "#/features/quote/schemas/dates";

// The Policies tab (6.2, decision 2). The same guard as /account; the data layer checks the Actor.
export const Route = createFileRoute("/account_/policies")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account/policies" } });
    return { summary };
  },
  loader: async ({ context }) => ({
    summary: context.summary,
    policies: await listMyPoliciesFn(),
    // One day for the server render and the browser's hydration
    today: todayIso(new Date()),
  }),
  head: () => ({ meta: [{ title: "Your policies · Kerb" }] }),
  component: Policies,
});

function Policies() {
  const { summary, policies, today } = Route.useLoaderData();
  return (
    <AccountShell name={summary.user.name} current="policies">
      <PoliciesPage policies={policies} today={today} />
    </AccountShell>
  );
}
