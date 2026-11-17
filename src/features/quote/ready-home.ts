import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { firstIncompleteHomeStep } from "./home-steps";
import { readJourney, type Journey } from "./journey-store";
import { priceQuery } from "./price-query";
import { todayIso } from "./schemas/dates";

// The home quote waiting in the tab, for the car journey's outcome screens (5.7b, decision 5):
// the home journey when every step is done and it prices as quoted, else null. It's only priced
// once complete, so a car journey with no home answers asks the server nothing.

export function useReadyHome(): Journey | null {
  const [home] = useState(() => readJourney("home"));
  const complete = home !== null && firstIncompleteHomeStep(home, todayIso()) === null;
  const { data } = useQuery(
    complete
      ? priceQuery("home", home)
      : { queryKey: ["quote-price", "home", "incomplete"], queryFn: skipToken },
  );
  return complete && data?.status === "quoted" ? home : null;
}
