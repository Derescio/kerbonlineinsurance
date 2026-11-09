import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { getSignInState } from "#/features/auth/guard";
import { ChallengeForm } from "#/features/auth/two-factor/ChallengeForm";
import { challengeGate } from "#/features/auth/two-factor/gate";

// The two-factor challenge (4.6, frames 09, 09b, 10). Not nested under /login (the `login_`
// name): /login's guard sends anyone with a session on to their redirect, which would bounce a
// session owing a code straight back here. challengeGate decides who stays (Review Focus 2).
const search = z.object({
  redirect: z.string().optional().catch(undefined),
  // From LoginForm after an email and password; the server's kerbTrustDevice comes as `trust`
  via: z.literal("email").optional().catch(undefined),
  trust: z.boolean().optional().catch(undefined),
  mode: z.literal("backup").optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/login_/two-factor")({
  validateSearch: search,
  beforeLoad: async ({ search: { redirect: to, via } }) => {
    const next = challengeGate(await getSignInState(), { redirect: to, via });
    if (next) throw redirect({ href: next });
  },
  head: () => ({ meta: [{ title: "Enter your code · Kerb" }] }),
  component: ChallengePage,
});

function ChallengePage() {
  const { redirect: to, via, trust, mode } = Route.useSearch();
  return <ChallengeForm redirect={to} via={via} trust={trust} mode={mode ?? "totp"} />;
}
