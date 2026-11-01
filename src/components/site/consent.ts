import { usePostHog } from "@posthog/react";
import type { PostHog } from "posthog-js";
import { useSyncExternalStore } from "react";

// The visitor's cookie choice (3.6). PostHog stores it and runs cookieless until it's "granted"
// (`cookieless_mode: "on_reject"` in src/routes/__root.tsx). This file only tells React when it
// changes, so the banner and the footer's "Cookie settings" stay in step.

export type ConsentStatus = "granted" | "denied" | "pending";

// Clients whose `loaded` callback has run. The provider inits PostHog in an effect, after its
// children's effects, so nothing may read consent until then.
const loaded = new WeakSet<object>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * PostHog's `loaded` option. Resumes replay for a visitor who accepted on an earlier visit. Typed
 * to what it uses, because PostHog hands `loaded` a narrower interface than the PostHog class.
 */
export function onPosthogLoaded(
  posthog: Pick<PostHog, "get_explicit_consent_status" | "startSessionRecording">,
) {
  if (posthog.get_explicit_consent_status() === "granted") posthog.startSessionRecording();
  loaded.add(posthog);
  notify();
}

/**
 * The visitor's choice and the ways to change it, or null while PostHog isn't running: on the
 * server, before PostHog loads, or when it isn't configured (no provider loads it).
 */
export function useConsent() {
  const posthog = usePostHog();
  const status = useSyncExternalStore(
    subscribe,
    (): ConsentStatus | null =>
      loaded.has(posthog) ? posthog.get_explicit_consent_status() : null,
    () => null,
  );
  if (status === null) return null;

  return {
    status,
    accept: () => {
      posthog.opt_in_capturing();
      posthog.startSessionRecording();
      notify();
    },
    reject: () => {
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
      notify();
    },
    /** Back to pending (cookieless), so the banner asks again. */
    reopen: () => {
      posthog.stopSessionRecording();
      posthog.clear_opt_in_out_capturing();
      notify();
    },
  };
}
