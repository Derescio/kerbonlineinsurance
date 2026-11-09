import { z } from "zod";

import { insertQuoteStarted } from "#/server/data/event-rows";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";

// quote.started (5.1, call 11): the first funnel milestone, written when a visitor reaches the car
// or home journey. The browser sends the postcode district only (plan P2) and a random journey id
// (plan P1). Limited per IP so the funnel can't be flooded.

export const QUOTE_START_RULE = { max: 30, windowSeconds: 60 * 60 };

export const startQuoteInput = z.strictObject({
  product: z.enum(["car", "home"]),
  // The outward code of a normalised postcode: "E8", "SW1A"
  district: z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]?$/),
  journeyId: z.uuid(),
  // PostHog's distinct id, only when the visitor accepted cookies
  anonymousId: z.string().min(1).max(200).nullable(),
});

export type StartQuoteInput = z.infer<typeof startQuoteInput>;

/**
 * Bad input writes nothing and says so; it only comes from a tampered request. The limit runs
 * first and throws `RateLimitError` past 30 an hour; a repeat in the same journey is not written.
 */
export async function recordQuoteStart(
  raw: unknown,
  headers: Headers,
  secret?: string,
): Promise<{ recorded: boolean }> {
  const parsed = startQuoteInput.safeParse(raw);
  if (!parsed.success) return { recorded: false };
  const subject = await rateLimitSubject(null, headers, secret);
  await limit(`quote.started:${subject}`, QUOTE_START_RULE);
  return { recorded: await insertQuoteStarted(parsed.data) };
}
