import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthShell } from "#/features/auth/AuthShell";
import { getSessionUser } from "#/features/auth/session";
import { SignUpForm } from "#/features/auth/SignUpForm";

export const Route = createFileRoute("/_auth/signup")({
  beforeLoad: async () => {
    if (await getSessionUser()) throw redirect({ to: "/account" });
  },
  head: () => ({ meta: [{ title: "Create your account · Kerb" }] }),
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <AuthShell
      topBar={{ text: "Already have an account?", to: "/login", label: "Log in" }}
      title="Create your account"
      subtitle="Manage your policy, documents and claims online."
    >
      <SignUpForm />
    </AuthShell>
  );
}
