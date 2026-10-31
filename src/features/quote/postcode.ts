import { z } from "zod";

export const postcodeError = "Enter your full postcode, like E8 3RL.";

// Outward code (A9, A99, AA9, AA99, A9A, AA9A), then the inward code (9AA). Format only: it
// doesn't check that the postcode exists.
const ukPostcode = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;

/** "e83rl" → "E8 3RL". Null when it isn't a full UK postcode. */
export function normalisePostcode(input: string): string | null {
  const match = ukPostcode.exec(input.replace(/\s+/g, "").toUpperCase());
  return match ? `${match[1]} ${match[2]}` : null;
}

/** Validates and normalises a postcode; the quote flow's server check reuses it (Phase 5). */
export const postcodeSchema = z.string().transform((value, ctx) => {
  const postcode = normalisePostcode(value);
  if (postcode === null) {
    ctx.addIssue({ code: "custom", message: postcodeError });
    return z.NEVER;
  }
  return postcode;
});
