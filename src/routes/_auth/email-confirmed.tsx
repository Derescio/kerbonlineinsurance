import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AuthShell } from "#/features/auth/AuthShell";
import { LINK_HOURS, SendNewLinkForm } from "#/features/auth/ResendVerification";

// Where the verification link lands (4.4). Success goes on to the account with the "Email
// confirmed" toast (07c); a bad or expired link shows 07d. An unconfirmed account can't log in
// (4.4b), so 07d asks for the email and sends a new link from here.
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
      subtitle={`Confirmation links work for ${LINK_HOURS} hours. Enter your email and we'll send a fresh one.`}
    >
      <SendNewLinkForm />
    </AuthShell>
  ),
});
