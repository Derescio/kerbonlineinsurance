import { createFileRoute, redirect } from "@tanstack/react-router";

import { ComingSoon } from "#/features/quote/ComingSoon";
import { comingSoonRedirect, comingSoonSearch } from "#/features/quote/search";

// /quote/coming-soon, screen 02: only for the five types not sold yet. Car, home or no type goes
// back to the start with the same search (plan P6).
export const Route = createFileRoute("/_quote/quote/coming-soon")({
  validateSearch: comingSoonSearch,
  beforeLoad: ({ search }) => {
    const back = comingSoonRedirect(search);
    if (back) throw redirect({ to: "/quote", search: back });
  },
  head: () => ({ meta: [{ title: "Coming soon · Kerb" }] }),
  component: ComingSoonPage,
});

function ComingSoonPage() {
  return <ComingSoon search={Route.useSearch()} />;
}
