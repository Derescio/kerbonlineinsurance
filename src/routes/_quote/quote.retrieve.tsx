import { createFileRoute } from "@tanstack/react-router";

import { requireSignedIn } from "#/features/auth/guard";
import { SavedQuotes } from "#/features/quote/SavedQuotes";
import { listMyQuotesFn } from "#/features/quote/server";

// /quote/retrieve, Your saved quotes (5.6, decision 10; screen 17). Signed in only: a guest goes to
// /login?redirect=/quote/retrieve. The list is the signed-in customer's own.
export const Route = createFileRoute("/_quote/quote/retrieve")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  loader: () => listMyQuotesFn(),
  head: () => ({ meta: [{ title: "Your saved quotes · Kerb" }] }),
  component: Retrieve,
});

function Retrieve() {
  const { owner, cards } = Route.useLoaderData();
  return <SavedQuotes owner={owner} cards={cards} />;
}
