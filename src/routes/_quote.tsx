import { Outlet, createFileRoute, useLocation, useSearch } from "@tanstack/react-router";

import { QuoteFrame } from "#/features/quote/QuoteFrame";

// Pathless layout: the quote pages' own frame (5.4b, decision 4), in place of the site chrome the
// 9 Nov decision gave them. The URLs stay under /quote.
export const Route = createFileRoute("/_quote")({ component: Quote });

function Quote() {
  const { pathname } = useLocation();
  const search = useSearch({ strict: false }) as { step?: string };
  return (
    <QuoteFrame pathname={pathname} search={search}>
      <Outlet />
    </QuoteFrame>
  );
}
