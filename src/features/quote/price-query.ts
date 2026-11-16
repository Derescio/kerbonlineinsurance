import { queryOptions } from "@tanstack/react-query";

import type { QuotePriceResult } from "#/server/quote/price";

import type { Journey } from "./journey-store";
import type { BuyableProductId } from "./products";
import { priceCar, priceHome } from "./server";

// The price for Your quote and Choose cover (5.4, spec decision 4; 5.5, decision 6; home from 5.7).
// Keyed by the product, the answers and the voluntary excess, so an edit fetches a new price and an
// unchanged journey reuses the one it has. A failure isn't retried: the view offers "Try again".
// The last plate typed stays in the tab (5.2, call 9); the pay choice, the cover level and the
// extras never change the server's answer (5.4b, call 10; 5.5, decision 6). Home has no voluntary
// excess (5.7), so it always asks at £0.

export function priceQuery(product: BuyableProductId, journey: Journey) {
  const { lastPlate: _lastPlate, payment: _payment, cover, ...sent } = journey;
  const voluntaryExcessPence = product === "home" ? 0 : (cover?.voluntaryExcessPence ?? 0);
  return queryOptions<QuotePriceResult>({
    queryKey: ["quote-price", product, sent, voluntaryExcessPence],
    queryFn: () =>
      product === "home"
        ? priceHome({ data: { journey: sent, voluntaryExcessPence } })
        : priceCar({ data: { journey: sent, voluntaryExcessPence } }),
    staleTime: Infinity,
    retry: false,
  });
}
