import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AccountShell } from "#/features/account/AccountShell";
import { Overview } from "#/features/account/Overview";
import { getMyNextPaymentFn, listMyPoliciesFn } from "#/features/account/policies";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";
import { useOneTimeToast } from "#/features/auth/use-one-time-toast";

// The Overview (6.1). Signed out → log in first; a session owing a 2FA code → the challenge first
// (4.6, call 14). This guard is UX only; the data layer (src/server/data/) checks the Actor from
// getActor. The toasts stay here for links made before settings moved (email confirmed, Google).
const search = z.object({
  confirmed: z.boolean().optional().catch(undefined),
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account" } });
    return { summary };
  },
  loader: async ({ context }) => {
    const [policies, nextPayment] = await Promise.all([listMyPoliciesFn(), getMyNextPaymentFn()]);
    return { summary: context.summary, policies, nextPayment };
  },
  head: () => ({ meta: [{ title: "Your account · Kerb" }] }),
  component: Account,
});

function Account() {
  const { summary, policies, nextPayment } = Route.useLoaderData();
  const notice = Route.useSearch();
  const navigate = useNavigate();
  useOneTimeToast(
    notice.confirmed
      ? { tone: "success", title: "Email confirmed", message: "Thanks. Your account is all set." }
      : notice.linked === "google"
        ? { tone: "success", title: "Google connected", message: "You can now log in with Google." }
        : notice.error
          ? {
              tone: "danger",
              title: "Google wasn't connected",
              message:
                "Use the Google account with the same email as your Kerb account, then try again.",
            }
          : null,
    () => void navigate({ to: "/account", search: {}, replace: true }),
  );
  return (
    <AccountShell name={summary.user.name} current="overview">
      <Overview name={summary.user.name} policies={policies} nextPayment={nextPayment} />
    </AccountShell>
  );
}
