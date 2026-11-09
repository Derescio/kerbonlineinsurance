import { createFileRoute, redirect } from "@tanstack/react-router";

import { QuoteStart } from "#/features/quote/QuoteStart";
import { checkStart, startSearch } from "#/features/quote/search";

// /quote, screen 01. The start form is a plain GET here with `next=1`: valid inputs redirect on
// to the journey or coming soon, and anything else renders the page with its errors, on the
// server when JavaScript is off (5.1, call 7).
export const Route = createFileRoute("/_site/quote/")({
  validateSearch: startSearch,
  beforeLoad: ({ search }) => {
    if (!search.next) return;
    const check = checkStart(search);
    if (check.ok) throw redirect({ to: check.to, search: check.search });
  },
  head: () => ({ meta: [{ title: "Get a quote · Kerb" }] }),
  component: QuoteStartPage,
});

function QuoteStartPage() {
  const search = Route.useSearch();
  // A new search (back, or a new link) starts the form again from the URL
  return <QuoteStart key={JSON.stringify(search)} search={search} />;
}
