import { TRUST_DEVICE_MAX_AGE_S } from "#/server/auth/two-factor-constants";

// Every cookie the site sets, as data for /cookies (4.7). Better Auth names are its defaults: the
// config in src/server/auth/auth.ts sets no cookiePrefix, and over HTTPS each name gains a
// `__Secure-` prefix. `auth.int.test.ts` checks every Set-Cookie the auth flow issues is listed
// here, so adding an auth feature that sets a new cookie fails that test until this list catches up.

export interface CookieInfo {
  name: string;
  purpose: string;
  duration: string;
  when: "always" | "after consent";
}

// Durations that aren't constants: 7 days and 5 minutes mirror `session.expiresIn` and
// `session.cookieCache.maxAge` in src/server/auth/auth.ts; 10 minutes is Better Auth's two-factor
// default (auth.ts doesn't set `twoFactorCookieMaxAge`). Change them together.
const trustDays = TRUST_DEVICE_MAX_AGE_S / (24 * 60 * 60);

export const COOKIES: CookieInfo[] = [
  {
    name: "better-auth.session_token",
    purpose: "Keeps you signed in.",
    duration: "7 days, renewed each day you use Kerb",
    when: "always",
  },
  {
    name: "better-auth.session_data",
    purpose:
      "A short-lived copy of your session, so pages load without a database lookup each time.",
    duration: "5 minutes",
    when: "always",
  },
  {
    name: "better-auth.dont_remember",
    purpose:
      "Set when you sign in without ticking 'Remember me', so your session ends when you close the browser.",
    duration: "Until you close your browser",
    when: "always",
  },
  {
    name: "better-auth.two_factor",
    purpose: "Holds your place between entering your password and entering your sign-in code.",
    duration: "10 minutes",
    when: "always",
  },
  {
    name: "better-auth.trust_device",
    purpose: "Remembers a device you chose to trust, so it skips the sign-in code.",
    duration: `${trustDays} days`,
    when: "always",
  },
  {
    name: "ph_<project key>_posthog",
    purpose:
      "PostHog's visitor ID and consent choice, used to understand how the site is used. PostHog keeps the same choice in your browser's local storage too.",
    duration: "1 year",
    when: "after consent",
  },
];
