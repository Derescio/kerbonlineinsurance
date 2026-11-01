import { useSyncExternalStore } from "react";

import {
  acceptCookies,
  consentStatus,
  rejectCookies,
  reopenConsent,
  subscribe,
} from "#/lib/analytics";

// The visitor's cookie choice (3.6), for the banner and the footer's "Cookie settings". PostHog
// stores it and runs cookieless until it's "granted" (src/lib/analytics.ts).

/**
 * The visitor's choice and the ways to change it, or null while PostHog isn't running: on the
 * server, before PostHog loads, or when it isn't configured.
 */
export function useConsent() {
  const status = useSyncExternalStore(subscribe, consentStatus, () => null);
  if (status === null) return null;
  return { status, accept: acceptCookies, reject: rejectCookies, reopen: reopenConsent };
}
