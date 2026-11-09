import { Outlet, createFileRoute } from "@tanstack/react-router";

// The quote journey (Phase 5) inside the site chrome: the live 3.1 header, not the one drawn in
// the quote frames (5.1, decision 2).
export const Route = createFileRoute("/_site/quote")({ component: QuoteLayout });

function QuoteLayout() {
  return (
    <div className="site-container">
      <Outlet />
    </div>
  );
}
