import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AuthShell } from "#/features/auth/AuthShell";
import { LinkExpired } from "#/features/auth/PasswordResetForms";

// Where the verification link lands (4.4). Success goes on to the account with the "Email
// confirmed" toast (07c); a bad or expired link shows 07d. A new link is sent from the banner on
// /account, which asks you to log in first if you aren't.
const search = z.object({ error: z.string().optional().catch(undefined) });

export const Route = createFileRoute("/_auth/email-confirmed")({
  validateSearch: search,
  beforeLoad: ({ search: { error } }) => {
    if (!error) throw redirect({ to: "/account", search: { confirmed: true } });
  },
  head: () => ({ meta: [{ title: "Confirm your email · Kerb" }] }),
  component: () => (
    <AuthShell
      topBar={{ text: "New to Kerb?", to: "/signup", label: "Create account" }}
      title="This link has expired"
      subtitle="Confirmation links work for 24 hours. We can send you a fresh one."
    >
      <LinkExpired again="/account" />
    </AuthShell>
  ),
});
