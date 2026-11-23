import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AccountShell } from "#/features/account/AccountShell";
import { SecuritySection } from "#/features/account/SecuritySection";
import { getMyRecentActivityFn } from "#/features/account/settings";
import { SettingsLayout } from "#/features/account/SettingsLayout";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary, getTwoFactorSetup } from "#/features/auth/session";
import { useOneTimeToast } from "#/features/auth/use-one-time-toast";

// Account settings, Security (6.3, decisions 5–7; Figma 06 276:3822, dialogs 07 and 08). Google
// comes back here after Connect Google, with the toasts that used to be on /account/settings.
const search = z.object({
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account_/settings_/security")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const [summary, setup] = await Promise.all([getAccountSummary(), getTwoFactorSetup()]);
    if (!summary || !setup) {
      throw redirect({ to: "/login", search: { redirect: "/account/settings/security" } });
    }
    return { summary, staff: setup.staff };
  },
  loader: async ({ context }) => ({
    summary: context.summary,
    staff: context.staff,
    activity: await getMyRecentActivityFn(),
  }),
  head: () => ({ meta: [{ title: "Security · Kerb" }] }),
  component: Security,
});

function Security() {
  const { summary, staff, activity } = Route.useLoaderData();
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
    () => void navigate({ to: "/account/settings/security", search: {}, replace: true }),
  );
  return (
    <AccountShell name={summary.user.name}>
      <SettingsLayout section="security">
        <SecuritySection summary={summary} staff={staff} activity={activity} />
      </SettingsLayout>
    </AccountShell>
  );
}
