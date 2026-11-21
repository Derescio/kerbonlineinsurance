import { createFileRoute, redirect } from "@tanstack/react-router";

import { AccountShell } from "#/features/account/AccountShell";
import { PolicyDetailPage } from "#/features/account/PolicyDetailPage";
import { getMyPolicyFn } from "#/features/account/policies";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";
import { todayIso } from "#/features/quote/schemas/dates";

// Policy detail (6.2, decision 1). Someone else's reference, or a missing one, is the site's
// not-found page: getMyPolicyFn throws notFound().
export const Route = createFileRoute("/account_/policies_/$reference")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: location.pathname } });
    return { summary };
  },
  loader: async ({ context, params }) => ({
    summary: context.summary,
    policy: await getMyPolicyFn({ data: { reference: params.reference } }),
    // One day for the server render and the browser's hydration
    today: todayIso(new Date()),
  }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.policy.reference ?? "Policy"} · Kerb` }],
  }),
  component: PolicyDetail,
});

function PolicyDetail() {
  const { summary, policy, today } = Route.useLoaderData();
  return (
    <AccountShell name={summary.user.name} current="policies">
      <PolicyDetailPage policy={policy} today={today} />
    </AccountShell>
  );
}
