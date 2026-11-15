import { createFileRoute } from "@tanstack/react-router";

import { requireSignedIn } from "#/features/auth/guard";
import { CoveredPage } from "#/features/quote/CoveredPage";
import { getPurchaseFn } from "#/features/quote/server";

// /quote/covered/$quoteId, You're covered (5.6, decisions 2 and 9; screen 18). Signed in only, and
// only the owner's bought quote: anything else is the site's not-found page.
export const Route = createFileRoute("/_quote/quote/covered/$quoteId")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  loader: ({ params }) => getPurchaseFn({ data: { quoteId: params.quoteId } }),
  head: () => ({ meta: [{ title: "You’re covered · Kerb" }] }),
  component: Covered,
});

function Covered() {
  return <CoveredPage purchase={Route.useLoaderData()} />;
}
