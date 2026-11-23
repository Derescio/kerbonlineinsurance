import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AccountShell } from "#/features/account/AccountShell";
import { PersonalDetails } from "#/features/account/PersonalDetails";
import { getMyPersonalDetailsFn } from "#/features/account/settings";
import { SettingsLayout } from "#/features/account/SettingsLayout";
import { requireSignedIn } from "#/features/auth/guard";

// Account settings, Personal details (6.3, decisions 2–4; Figma 01 182:3254, 02 182:3358). Ways to
// log in moved to Security, so Google's return from an older link (?linked=, ?error=) goes there.
const search = z.object({
  linked: z.literal("google").optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/account_/settings")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location, search: { linked, error } }) => {
    if (linked || error)
      throw redirect({ to: "/account/settings/security", search: { linked, error } });
    await requireSignedIn(location);
  },
  loader: () => getMyPersonalDetailsFn(),
  head: () => ({ meta: [{ title: "Account settings · Kerb" }] }),
  component: Settings,
});

function Settings() {
  const details = Route.useLoaderData();
  return (
    <AccountShell name={details.name}>
      <SettingsLayout section="personal">
        <PersonalDetails details={details} />
      </SettingsLayout>
    </AccountShell>
  );
}
