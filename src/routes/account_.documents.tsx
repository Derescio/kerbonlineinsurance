import { createFileRoute, redirect } from "@tanstack/react-router";

import { AccountShell } from "#/features/account/AccountShell";
import { DocumentsPage } from "#/features/account/DocumentsPage";
import { listMyPoliciesFn } from "#/features/account/policies";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";
import { todayIso } from "#/features/quote/schemas/dates";

// The Documents tab (6.2, decision 2). The same guard as /account; the documents route checks the
// owner again when a file is asked for.
export const Route = createFileRoute("/account_/documents")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account/documents" } });
    return { summary };
  },
  loader: async ({ context }) => ({
    summary: context.summary,
    policies: await listMyPoliciesFn(),
    // One day for the server render and the browser's hydration
    today: todayIso(new Date()),
  }),
  head: () => ({ meta: [{ title: "Documents · Kerb" }] }),
  component: Documents,
});

function Documents() {
  const { summary, policies, today } = Route.useLoaderData();
  return (
    <AccountShell name={summary.user.name} current="documents">
      <DocumentsPage policies={policies} today={today} />
    </AccountShell>
  );
}
