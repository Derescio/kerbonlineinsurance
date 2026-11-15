import { createFileRoute, redirect } from "@tanstack/react-router";

import { requireSignedIn } from "#/features/auth/guard";
import { PayPage } from "#/features/quote/PayPage";
import { getQuoteForPaymentFn } from "#/features/quote/server";

// /quote/pay/$quoteId, Confirm and pay (5.6, decisions 2 and 6). Signed in only, and only the
// owner's quote: anyone else's, or a missing one, is the site's not-found page (the server
// function throws notFound()). It reads the saved quote, so it works from Your saved quotes too. A
// quote already bought goes to its You're covered page.
export const Route = createFileRoute("/_quote/quote/pay/$quoteId")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  loader: async ({ params }) => {
    const summary = await getQuoteForPaymentFn({ data: { quoteId: params.quoteId } });
    if (summary.status === "accepted") {
      throw redirect({ to: "/quote/covered/$quoteId", params, replace: true });
    }
    return summary;
  },
  head: () => ({ meta: [{ title: "Confirm and pay · Kerb" }] }),
  component: Pay,
});

function Pay() {
  return <PayPage summary={Route.useLoaderData()} />;
}
