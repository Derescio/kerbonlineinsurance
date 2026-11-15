import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { Alert } from "#/components/feedback/Alert";
import { getBillingPortal, NO_MONTHLY_CARD } from "#/features/account/billing";
import { requireSignedIn } from "#/features/auth/guard";
import { AuthShell } from "#/features/auth/AuthShell";

// Update the payment card (5.6b, decision 9). An auth-layout page, not nested under /account (the
// `account_` name). A monthly customer is sent on to Stripe's customer portal, made on the server
// for their own Stripe customer, which returns them to /account; anyone else sees why there's no
// card to update.
export const Route = createFileRoute("/account_/billing")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const billing = await getBillingPortal();
    // An external URL: the router answers with a redirect on the server, a full load in the browser
    if (billing.kind === "portal") throw redirect({ href: billing.url });
  },
  head: () => ({ meta: [{ title: "Your payment card · Kerb" }] }),
  component: NoMonthlyCard,
});

function NoMonthlyCard() {
  return (
    <AuthShell
      topBar={{
        text: "Nothing to change here.",
        action: (
          <Link to="/account" className="kb-btn kb-btn--secondary kb-btn--sm">
            <span>Back to account</span>
          </Link>
        ),
      }}
      title="Your payment card"
    >
      <Alert tone="info">{NO_MONTHLY_CARD}</Alert>
    </AuthShell>
  );
}
