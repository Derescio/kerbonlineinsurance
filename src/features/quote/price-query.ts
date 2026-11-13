import { queryOptions } from "@tanstack/react-query";

import type { Journey } from "./journey-store";
import { priceCar } from "./server";

// The car price for Your quote and Choose cover (5.4, spec decision 4; 5.5, decision 6). Keyed by
// the answers and the voluntary excess, so an edit fetches a new price and an unchanged journey
// reuses the one it has. A failure isn't retried: the view offers "Try again". The last plate typed
// stays in the tab (5.2, call 9); the pay choice, the cover level and the extras never change the
// server's answer (5.4b, call 10; 5.5, decision 6).

export function priceQuery(journey: Journey) {
  const { lastPlate: _lastPlate, payment: _payment, cover, ...sent } = journey;
  const voluntaryExcessPence = cover?.voluntaryExcessPence ?? 0;
  return queryOptions({
    queryKey: ["quote-price", sent, voluntaryExcessPence],
    queryFn: () => priceCar({ data: { journey: sent, voluntaryExcessPence } }),
    staleTime: Infinity,
    retry: false,
  });
}
