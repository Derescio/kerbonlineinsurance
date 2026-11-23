import { createFileRoute, redirect } from "@tanstack/react-router";

import { AccountShell } from "#/features/account/AccountShell";
import { SettingsLayout, SettingsTitle } from "#/features/account/SettingsLayout";
import { requireSignedIn } from "#/features/auth/guard";
import { getAccountSummary } from "#/features/auth/session";

// Account settings, Security (6.3, decision 5; Figma 06 276:3822).
export const Route = createFileRoute("/account_/settings_/security")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    const summary = await getAccountSummary();
    if (!summary) {
      throw redirect({ to: "/login", search: { redirect: "/account/settings/security" } });
    }
    return { summary };
  },
  loader: ({ context }) => ({ summary: context.summary }),
  head: () => ({ meta: [{ title: "Security · Kerb" }] }),
  component: Security,
});

function Security() {
  const { summary } = Route.useLoaderData();
  return (
    <AccountShell name={summary.user.name}>
      <SettingsLayout section="security">
        <SettingsTitle>Security</SettingsTitle>
      </SettingsLayout>
    </AccountShell>
  );
}
