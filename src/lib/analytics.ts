import type { PostHog, PostHogConfig, Properties } from "posthog-js";

import { maskPostcode } from "#/lib/mask-postcode";

// The one way into PostHog (plan/engineering.md §13, slice 3.5). Components call `track`, never
// posthog-js: it loads with a dynamic import() once the page is idle, so it stays out of the
// landing JS budget, and calls made before then are queued. With no env vars (local without
// .env.local, Vitest, CI) everything here is a no-op.

const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

export const analyticsEnabled = Boolean(token && host);

if (import.meta.env.DEV && !analyticsEnabled && import.meta.env.MODE !== "test") {
  console.warn(
    "PostHog is off: set VITE_PUBLIC_POSTHOG_PROJECT_TOKEN and VITE_PUBLIC_POSTHOG_HOST in .env.local to send events.",
  );
}

/** Same-origin proxy to PostHog (vite.config.ts), so blocklists don't drop events and the CSP stays 'self'. */
export const posthogApiHost = "/ingest";

export type ConsentStatus = "granted" | "denied" | "pending";

const options: Partial<PostHogConfig> = {
  api_host: posthogApiHost,
  // Links back to the PostHog app (toolbar, debug output): the app host, not the ingest host
  ui_host: host?.replace(".i.posthog.com", ".posthog.com"),
  defaults: "2025-05-24",
  capture_exceptions: true,
  debug: import.meta.env.DEV,
  // No cookies or storage until the visitor accepts (3.6). on_reject alone captures nothing while
  // the choice is pending, so opt_out_capturing_by_default treats "no choice yet" as rejected:
  // cookieless, still counted. Needs "Cookieless server hash mode" on in the PostHog project.
  cookieless_mode: "on_reject",
  opt_out_capturing_by_default: true,
  // Replay only after consent: acceptCookies() starts it, and attachPosthog() resumes it.
  disable_session_recording: true,
  // The hero form puts the postcode in the URL. PostHog masks it in URLs it records (pages,
  // replay, heatmaps); maskPostcode catches the rest, like the next page's $referrer.
  mask_personal_data_properties: true,
  custom_personal_data_properties: ["postcode"],
  before_send: maskPostcode,
  // Replay records layout and clicks only: inputs and all page text are masked, because quote and
  // policy pages show names, addresses and vehicle details. Wins over the dashboard's masking.
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: "*",
  },
};

type Client = Pick<
  PostHog,
  | "capture"
  | "captureException"
  | "getFeatureFlag"
  | "onFeatureFlags"
  | "get_explicit_consent_status"
  | "opt_in_capturing"
  | "opt_out_capturing"
  | "clear_opt_in_out_capturing"
  | "startSessionRecording"
  | "stopSessionRecording"
>;

let client: Client | undefined;
let started = false;
const queue: [event: string, properties?: Properties][] = [];
const waitingForLoad: ((posthog: Client) => void)[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * PostHog's `loaded` callback: from here on events go straight out, the queue is sent, and consent
 * can be read. Resumes replay for a visitor who accepted on an earlier visit. Tests pass a fake
 * client, or undefined to go back to "not loaded".
 */
export function attachPosthog(posthog: Client | undefined) {
  client = posthog;
  if (posthog) {
    if (posthog.get_explicit_consent_status() === "granted") posthog.startSessionRecording();
    for (const [event, properties] of queue.splice(0)) posthog.capture(event, properties);
    for (const run of waitingForLoad.splice(0)) run(posthog);
  }
  notify();
}

function whenIdle(run: () => void) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1);
}

/** Loads PostHog once the browser is idle. Called once, after hydration (src/routes/__root.tsx). */
export function startAnalytics() {
  if (!token || !host || started) return;
  started = true;
  whenIdle(() => {
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(token, { ...options, loaded: attachPosthog });
    });
  });
}

/** Sends an event, or queues it until PostHog has loaded. */
export function track(event: string, properties?: Properties) {
  if (client) client.capture(event, properties);
  else if (analyticsEnabled) queue.push([event, properties]);
}

/**
 * A feature flag's value for this visitor (3.5 experiments), or undefined: when PostHog isn't
 * configured, when the visitor hasn't accepted cookies (cookieless visitors share one ID, so a
 * flag can't split them), or when flags fail or take longer than `timeoutMs` after PostHog loads.
 * Callers render the control for undefined. Reading the flag records the experiment exposure.
 */
export function getFlag(key: string, timeoutMs = 1500): Promise<string | boolean | undefined> {
  if (!analyticsEnabled) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const read = (posthog: Client) => {
      if (posthog.get_explicit_consent_status() !== "granted") return resolve(undefined);
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      posthog.onFeatureFlags(() => {
        clearTimeout(timer);
        resolve(posthog.getFeatureFlag(key));
      });
    };
    if (client) read(client);
    else waitingForLoad.push(read);
  });
}

/** Reports an error caught by a React error boundary. Uncaught errors are captured by PostHog itself. */
export function captureException(error: unknown) {
  client?.captureException(error);
}

// Consent (3.6). PostHog stores the choice; these tell React when it changes.

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The visitor's cookie choice, or null while PostHog isn't running (server, not loaded, not configured). */
export function consentStatus(): ConsentStatus | null {
  return client ? client.get_explicit_consent_status() : null;
}

export function acceptCookies() {
  client?.opt_in_capturing();
  client?.startSessionRecording();
  notify();
}

export function rejectCookies() {
  client?.stopSessionRecording();
  client?.opt_out_capturing();
  notify();
}

/** Back to pending (cookieless), so the cookie bar asks again. */
export function reopenConsent() {
  client?.stopSessionRecording();
  client?.clear_opt_in_out_capturing();
  notify();
}
