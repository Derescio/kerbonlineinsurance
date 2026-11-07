import { getActor, type Actor } from "#/server/auth/actor";

// Server only: guard.ts's getSignInState imports this inside its handler, so the database code it
// reaches stays out of the browser bundle. It decides from getActor, which reads the session with
// the cookie cache off (4.6, call 14).

export type SignInState = "guest" | "needs_code" | "signed_in";

/** A session owes a code when the account has 2FA on and the session hasn't given one */
export function signInStateFor(actor: Actor | null): SignInState {
  if (!actor) return "guest";
  if (actor.twoFactor.enabled && actor.twoFactor.verifiedAt === null) return "needs_code";
  return "signed_in";
}

/** The sign-in state behind a request's cookies */
export async function readSignInState(headers: Headers): Promise<SignInState> {
  return signInStateFor(await getActor(headers));
}
