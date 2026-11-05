import { and, eq, ne } from "drizzle-orm";

import type { Db } from "#/server/db/client";
import { accounts, sessions, users } from "#/server/db/schema";

// When a Google account may join an existing Kerb account (4.4, decision 2, agreed 4 Nov 2026).
// Better Auth has already refused any Google email that Google itself hasn't verified (Google is
// not a trusted provider here), so these rules only see verified Google emails.
//
// - Connect Google, from a session signed in as that user: allowed (an explicit link).
// - A brand-new user (Google is their first sign-in method): allowed.
// - An existing account whose email was never verified: allowed, and its password and sessions are
//   removed afterwards, since whoever set them never proved they own the address.
// - An existing account whose email is verified: refused. The owner logs in and connects Google.

export const GOOGLE = "google";

/** The error code the refused sign-in carries back to /login (?error=…), which shows frame 08b */
export const ACCOUNT_EXISTS_CODE = "ACCOUNT_EXISTS_VERIFIED";

export const ACCOUNT_EXISTS_MESSAGE =
  "You already have a Kerb account with this email. Log in with your password, then connect Google from your account.";

export type GoogleLinkDecision = "explicit" | "new-user" | "replace-unverified" | "refuse";

export async function decideGoogleLink(
  db: Db,
  { userId, signedInUserId }: { userId: string; signedInUserId: string | null },
): Promise<GoogleLinkDecision> {
  if (signedInUserId === userId) return "explicit";
  const others = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.providerId, GOOGLE)))
    .limit(1);
  if (others.length === 0) return "new-user";
  const [user] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));
  return user?.emailVerified ? "refuse" : "replace-unverified";
}

/** Removes the unproven password and signs out every session it opened (decision 2). */
export async function removeUnverifiedPassword(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}
