import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { publicMiddleware } from "#/server/auth/middleware";
import type { PostcodeCheck } from "#/server/quote/postcode";
import type { CarPriceResult } from "#/server/quote/price";
import type { StartQuoteInput } from "#/server/quote/start";

// The quote journey's server functions. Server modules are imported inside the handlers, which
// the client build strips, so the database stays server-side.

/** Records quote.started for a journey (5.1, call 11). The shell sends it once and ignores failures. */
export const startQuote = createServerFn({ method: "POST" })
  .middleware([publicMiddleware])
  .validator((input: StartQuoteInput) => input)
  .handler(async ({ data }): Promise<{ recorded: boolean }> => {
    const { recordQuoteStart } = await import("#/server/quote/start");
    return recordQuoteStart(data, getRequestHeaders());
  });

/** Does the car journey's postcode exist (5.2, call 15)? Only "not_found" stops the visitor. */
export const checkPostcode = createServerFn({ method: "POST" })
  .middleware([publicMiddleware])
  .validator((input: { postcode: string }) => ({ postcode: String(input?.postcode ?? "") }))
  .handler(async ({ data }): Promise<{ result: PostcodeCheck }> => {
    const { checkPostcodeExists } = await import("#/server/quote/postcode");
    return { result: await checkPostcodeExists(data.postcode, getRequestHeaders()) };
  });

/**
 * The car journey's Comprehensive price, or why there isn't one (5.4, spec decision 3). The tab
 * sends its journey; the server checks it again and prices it. Nothing is saved.
 */
export const priceCar = createServerFn({ method: "POST" })
  .middleware([publicMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<CarPriceResult> => {
    const { priceCarJourney } = await import("#/server/quote/price");
    return priceCarJourney(data, getRequestHeaders());
  });
