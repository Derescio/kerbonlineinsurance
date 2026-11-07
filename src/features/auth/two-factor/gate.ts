import { safeRedirect } from "../auth-client";
import { challengeRedirect, type SignInState } from "../guard";

// Who may stay on /login/two-factor (frame 09; Review Focus 2). /login's own guard would send a
// session owing a code on to its redirect, which bounces it straight back here, so the challenge
// is its own route with this rule.

export interface ChallengeSearch {
  redirect?: string;
  via?: "email";
}

/**
 * null to stay, otherwise where to go. In sign-in mode (an email and password, call 8) there's no
 * session yet, only Better Auth's two_factor cookie, so getSignInState says guest: a guest who
 * came from the log-in form (via=email) stays. If their cookie has gone, the verify answers 401
 * INVALID_TWO_FACTOR_COOKIE and the page asks them to sign in again. Any other guest has nothing
 * to answer.
 */
export function challengeGate(state: SignInState, search: ChallengeSearch): string | null {
  if (state === "guest") {
    if (search.via === "email") return null;
    const back = safeRedirect(search.redirect, "");
    return back ? `/login?redirect=${encodeURIComponent(back)}` : "/login";
  }
  return challengeRedirect(state, search.redirect);
}
