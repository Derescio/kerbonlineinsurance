import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { userMiddleware } from "#/server/auth/middleware";

// The signed-in user, read on the server from the session cookie (4.4). Route guards use it for
// UX only; the data layer (src/server/data/) checks the Actor from getActor.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export const getSessionUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const { getAuth } = await import("#/server/auth/auth");
    const session = await getAuth().api.getSession({ headers: getRequestHeaders() });
    if (!session) return null;
    const { id, name, email, emailVerified } = session.user;
    return { id, name, email, emailVerified };
  },
);

export interface AccountSummary {
  user: SessionUser;
  /** Sign-in methods: "credential" (a password) and "google" */
  providers: string[];
  /** "Good morning" etc., worked out in UK time on the server so it matches after hydration */
  greeting: string;
}

export const getAccountSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<AccountSummary | null> => {
    const { getAuth } = await import("#/server/auth/auth");
    const headers = getRequestHeaders();
    const auth = getAuth();
    // Straight from the database, not the 5-minute cookie cache: when Google links to an
    // unverified account, the cached copy still says the email is unconfirmed (4.4, Damion's run)
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) return null;
    const accounts = await auth.api.listUserAccounts({ headers });
    const { id, name, email, emailVerified } = session.user;
    return {
      user: { id, name, email, emailVerified },
      providers: accounts.map((account) => account.providerId),
      greeting: greetingFor(new Date()),
    };
  },
);

/**
 * "Sign out everywhere" (4.6, call 11): ends every one of the user's sessions, this one included,
 * in one audited transaction. 6.3 adds the button; nothing links to it yet. userMiddleware refuses
 * a session that still owes a 2FA code, which can only sign out itself
 */
export const signOutEverywhereFn = createServerFn({ method: "POST" })
  .middleware([userMiddleware])
  .handler(async ({ context }): Promise<{ revoked: number }> => {
    const { signOutEverywhereNow } = await import("#/server/auth/sessions");
    return signOutEverywhereNow(context.actor, getRequestHeaders());
  });

export function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Europe/London",
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
