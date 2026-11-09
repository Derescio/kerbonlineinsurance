import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { safeRedirect } from "./auth-client";
import type { SignInState } from "./sign-in-state";

// The signed-in guard for customer pages (4.6, call 14). UX only: the data layer checks the Actor.
// It decides from getActor, which reads the session with the cookie cache off: Better Auth's cached
// getSession shows no stamp for up to 5 minutes after a code, so it must never gate here.

export type { SignInState };

export const getSignInState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SignInState> => {
    // Imported inside the handler, which the client build strips, so the database stays server-side
    const { readSignInState } = await import("./sign-in-state");
    return readSignInState(getRequestHeaders());
  },
);

/** Frame 09, /login/two-factor, as an href with its redirect */
export const twoFactorChallengeHref = (redirectTo: string) =>
  `/login/two-factor?redirect=${encodeURIComponent(redirectTo)}`;

/** Frame 12 for staff, /account/two-factor, as an href with its redirect */
export const accountTwoFactorHref = (redirectTo: string) =>
  `/account/two-factor?redirect=${encodeURIComponent(redirectTo)}`;

/**
 * For a signed-in page's `beforeLoad`: a guest goes to log in, and a session owing a code goes to
 * the challenge, each coming back to `location.href` after
 */
export async function requireSignedIn(location: { href: string }): Promise<void> {
  const state = await getSignInState();
  if (state === "guest") throw redirect({ to: "/login", search: { redirect: location.href } });
  if (state === "needs_code") throw redirect({ href: twoFactorChallengeHref(location.href) });
}

/**
 * Where /login/two-factor's `beforeLoad` sends each state (Review Focus 2): a session with nothing
 * owing goes on to `redirect` (same-site only), a guest has no challenge to answer, and a session
 * owing a code stays (null)
 */
export function challengeRedirect(state: SignInState, redirectTo: unknown): string | null {
  if (state === "signed_in") return safeRedirect(redirectTo);
  if (state === "guest") return "/login";
  return null;
}
