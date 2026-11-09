import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { publicMiddleware } from "#/server/auth/middleware";
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
