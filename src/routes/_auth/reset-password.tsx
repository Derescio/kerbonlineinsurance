import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AuthShell } from "#/features/auth/AuthShell";
import { LinkExpired, ResetPasswordForm } from "#/features/auth/PasswordResetForms";

// Better Auth's reset link lands here with ?token=…, or ?error=INVALID_TOKEN once it has expired
// or been used (frames 06, 06b).
const search = z.object({
  token: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/reset-password")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Set a new password · Kerb" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  const [expired, setExpired] = useState(!token || Boolean(error));
  const topBar = { text: "New to Kerb?", to: "/signup", label: "Create account" } as const;
  if (expired || !token) {
    return (
      <AuthShell
        topBar={topBar}
        title="This link has expired"
        subtitle="Reset links work once, for one hour. Ask for a new one and use the newest email."
      >
        <LinkExpired again="/forgot-password" />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      topBar={topBar}
      title="Set a new password"
      subtitle="Use at least 10 characters. You'll log in with it from now on."
    >
      <ResetPasswordForm token={token} onExpired={() => setExpired(true)} />
    </AuthShell>
  );
}
