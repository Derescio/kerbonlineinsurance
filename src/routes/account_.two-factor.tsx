import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { safeRedirect } from "#/features/auth/auth-client";
import { requireSignedIn } from "#/features/auth/guard";
import { getTwoFactorSetup } from "#/features/auth/session";
import { SetupSteps } from "#/features/auth/two-factor/SetupSteps";

// Turning two-factor on (4.6, frames 12, 11a–11c). An auth-layout page, not nested under /account
// (the `account_` name). Staff are sent here from /staff with ?redirect=; customers come from the
// link on /account. With 2FA already on there's nothing to set up, so it goes on to the redirect.
const search = z.object({
  redirect: z.string().optional().catch(undefined),
  // Back from confirming with Google (11a, Google version)
  step: z.literal("scan").optional().catch(undefined),
});

export const Route = createFileRoute("/account_/two-factor")({
  validateSearch: search,
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location, search: { redirect: to } }) => {
    await requireSignedIn(location);
    const setup = await getTwoFactorSetup();
    if (!setup) throw redirect({ to: "/login", search: { redirect: location.href } });
    if (setup.twoFactorEnabled) throw redirect({ href: safeRedirect(to) });
    return { setup };
  },
  loader: ({ context }) => context.setup,
  head: () => ({ meta: [{ title: "Set up two-factor · Kerb" }] }),
  component: TwoFactorSetupPage,
});

function TwoFactorSetupPage() {
  const setup = Route.useLoaderData();
  const { redirect: to, step } = Route.useSearch();
  return <SetupSteps setup={setup} redirect={to} step={step} />;
}
