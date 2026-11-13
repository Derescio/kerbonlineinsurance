import { queryOptions } from "@tanstack/react-query";

import type { Journey } from "./journey-store";
import { priceCar } from "./server";

// The car price for the holding view (5.4, spec decision 4). Keyed by the answers, so an edit
// fetches a new price and an unchanged journey reuses the one it has. A failure isn't retried: the
// view offers "Try again". The last plate typed stays in the tab (5.2, call 9), and so does the pay
// choice: it never changes the price (5.4b, call 10).

export function priceQuery(journey: Journey) {
  const { lastPlate: _lastPlate, payment: _payment, ...sent } = journey;
  return queryOptions({
    queryKey: ["quote-price", sent],
    queryFn: () => priceCar({ data: sent }),
    staleTime: Infinity,
    retry: false,
  });
}
