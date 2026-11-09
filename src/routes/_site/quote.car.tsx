import { createFileRoute, redirect } from "@tanstack/react-router";

import { JourneyShell } from "#/features/quote/JourneyShell";
import { journeySearch } from "#/features/quote/search";

// /quote/car: the car journey shell. No valid postcode in the link goes back to the start with car
// picked (5.1, call 5).
export const Route = createFileRoute("/_site/quote/car")({
  validateSearch: journeySearch,
  beforeLoad: ({ search }) => {
    if (!search.postcode) throw redirect({ to: "/quote", search: { type: "car" } });
  },
  head: () => ({ meta: [{ title: "Car quote · Kerb" }] }),
  component: CarQuotePage,
});

function CarQuotePage() {
  const { postcode } = Route.useSearch();
  return postcode ? <JourneyShell product="car" postcode={postcode} /> : null;
}
