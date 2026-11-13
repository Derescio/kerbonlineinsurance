import type { RateRule } from "#/server/db/rate-limit";

// Rate rules for writes that don't own a module of their own (4.5c names this file). Each is per
// signed-in user, keyed by the write's action.

/** Saving a car quote at the gate (5.6, decision 5) */
export const QUOTE_SAVE_RULE: RateRule = { max: 20, windowSeconds: 60 * 60 };

/** Paying for a saved quote (5.6, decision 7) */
export const QUOTE_PAY_RULE: RateRule = { max: 10, windowSeconds: 60 * 60 };
