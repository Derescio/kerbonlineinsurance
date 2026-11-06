// Two-factor timings (4.6). In their own file, importing nothing, so actor.ts and the browser-safe
// pieces can use them without loading the Better Auth plugin.

/** How recently staff must have given a code for a sensitive action */
export const STAFF_FRESH_MS = 2 * 60 * 60 * 1000;
/** The same, for someone signed in without a password (Google) */
export const PASSWORDLESS_FRESH_MS = 10 * 60 * 1000;
/** Wrong codes in a row before the account is locked out */
export const LOCKOUT_AFTER = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;
/** How long "trust this device" skips the code, in seconds (Better Auth's unit) */
export const TRUST_DEVICE_MAX_AGE_S = 30 * 24 * 60 * 60;
