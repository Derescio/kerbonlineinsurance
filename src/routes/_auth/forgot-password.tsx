import { createFileRoute } from "@tanstack/react-router";

import { AuthShell } from "#/features/auth/AuthShell";
import { ForgotPasswordForm } from "#/features/auth/PasswordResetForms";

export const Route = createFileRoute("/_auth/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password · Kerb" }] }),
  component: () => (
    <AuthShell
      topBar={{ text: "New to Kerb?", to: "/signup", label: "Create account" }}
      title="Reset your password"
      subtitle="Enter the email you use for Kerb and we'll send you a link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  ),
});
