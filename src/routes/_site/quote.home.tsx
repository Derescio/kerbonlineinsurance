import { createFileRoute, redirect } from "@tanstack/react-router";

import { JourneyShell } from "#/features/quote/JourneyShell";
import { journeySearch } from "#/features/quote/search";

// /quote/home: the home journey shell. No valid postcode in the link goes back to the start with home
// picked (5.1, call 5).
export const Route = createFileRoute("/_site/quote/home")({
  validateSearch: journeySearch,
  beforeLoad: ({ search }) => {
    if (!search.postcode) throw redirect({ to: "/quote", search: { type: "home" } });
  },
  head: () => ({ meta: [{ title: "Home quote · Kerb" }] }),
  component: HomeQuotePage,
});

function HomeQuotePage() {
  const { postcode } = Route.useSearch();
  return postcode ? <JourneyShell product="home" postcode={postcode} /> : null;
}
