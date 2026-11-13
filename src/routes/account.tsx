import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { listMyPoliciesFn } from "#/features/account/policies";
import { AccountPage } from "#/features/auth/AccountPage";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";

// The minimal account page (4.4, decision 6). Signed out → log in first; a session owing a 2FA code
// → the challenge first (4.6, call 14). This guard is UX only; the data layer (src/server/data/)
// checks the Actor from getActor.
const search = z.object({
  confirmed: z.boolean().optional().catch(undefined),
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account" } });
    return { summary };
  },
  loader: async ({ context }) => ({
    summary: context.summary,
    policies: await listMyPoliciesFn(),
  }),
  head: () => ({ meta: [{ title: "Your account · Kerb" }] }),
  component: Account,
});

function Account() {
  const { summary, policies } = Route.useLoaderData();
  const notice = Route.useSearch();
  return <AccountPage summary={summary} policies={policies} notice={notice} />;
}
