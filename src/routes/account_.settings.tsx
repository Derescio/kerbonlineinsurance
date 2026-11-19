import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AccountSettings } from "#/features/account/AccountSettings";
import { AccountShell } from "#/features/account/AccountShell";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";
import { useOneTimeToast } from "#/features/auth/use-one-time-toast";

// Account settings (6.1, decision 2), behind the avatar menu. The same guard as /account, and the
// Connect Google toasts, since Google now comes back here.
const search = z.object({
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account_/settings")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) throw redirect({ to: "/login", search: { redirect: "/account/settings" } });
    return { summary };
  },
  loader: ({ context }) => ({ summary: context.summary }),
  head: () => ({ meta: [{ title: "Account settings · Kerb" }] }),
  component: Settings,
});

function Settings() {
  const { summary } = Route.useLoaderData();
  const notice = Route.useSearch();
  const navigate = useNavigate();
  useOneTimeToast(
    notice.linked === "google"
      ? { tone: "success", title: "Google connected", message: "You can now log in with Google." }
      : notice.error
        ? {
            tone: "danger",
            title: "Google wasn't connected",
            message:
              "Use the Google account with the same email as your Kerb account, then try again.",
          }
        : null,
    () => void navigate({ to: "/account/settings", search: {}, replace: true }),
  );
  return (
    <AccountShell name={summary.user.name}>
      <AccountSettings summary={summary} />
    </AccountShell>
  );
}
