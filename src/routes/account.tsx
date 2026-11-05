import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AccountPage } from "#/features/auth/AccountPage";
import { getAccountSummary } from "#/features/auth/session";

// The minimal account page (4.4, decision 6). Signed out → log in first. This guard is UX only;
// the data layer (src/server/data/) checks the Actor from getActor.
const search = z.object({
  confirmed: z.boolean().optional().catch(undefined),
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async () => {
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account" } });
    return { summary };
  },
  loader: ({ context }) => context.summary,
  head: () => ({ meta: [{ title: "Your account · Kerb" }] }),
  component: Account,
});

function Account() {
  const summary = Route.useLoaderData();
  const notice = Route.useSearch();
  return <AccountPage summary={summary} notice={notice} />;
}
