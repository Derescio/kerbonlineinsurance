import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { requireSignedIn } from "#/features/auth/guard";
import { CoveredPage } from "#/features/quote/CoveredPage";
import { getPurchaseFn } from "#/features/quote/server";

// /quote/covered/$quoteId, You're covered (5.6, decisions 2 and 9; screen 18). Signed in only, and
// only the owner's bought quote: anything else is the site's not-found page.
//
// Stripe's form returns here with `session_id` (5.6b, decision 11). The quote may not be bought yet,
// so the page confirms the session first and reads the purchase after, instead of the loader.
const search = z.object({ session_id: z.string().optional().catch(undefined) });

export const Route = createFileRoute("/_quote/quote/covered/$quoteId")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  loaderDeps: ({ search: { session_id } }) => ({ sessionId: session_id }),
  loader: ({ params, deps }) =>
    deps.sessionId ? null : getPurchaseFn({ data: { quoteId: params.quoteId } }),
  head: () => ({ meta: [{ title: "You’re covered · Kerb" }] }),
  component: Covered,
});

function Covered() {
  const { quoteId } = Route.useParams();
  const { session_id } = Route.useSearch();
  return <CoveredPage quoteId={quoteId} purchase={Route.useLoaderData()} sessionId={session_id} />;
}
