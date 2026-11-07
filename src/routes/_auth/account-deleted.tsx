import { Link, createFileRoute } from "@tanstack/react-router";

import { AuthShell } from "#/features/auth/AuthShell";

// Where a deleted account lands (4.7). Static: the account and its session are already gone.
export const Route = createFileRoute("/_auth/account-deleted")({
  head: () => ({ meta: [{ title: "Account deleted · Kerb" }] }),
  component: () => (
    <AuthShell
      topBar={{ text: "New to Kerb?", to: "/signup", label: "Create account" }}
      title="Your account has been deleted"
      subtitle="Everything in it has been removed, and we've emailed you to confirm."
    >
      <Link to="/" className="kb-btn kb-btn--primary kb-btn--lg kb-btn--full">
        <span>Back to the Kerb home page</span>
      </Link>
    </AuthShell>
  ),
});
