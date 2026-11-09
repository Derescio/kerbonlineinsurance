import { createFileRoute } from "@tanstack/react-router";

import { ClosePage } from "#/features/account/ClosePage";
import { getClosePage } from "#/features/account/closure";
import { requireSignedIn } from "#/features/auth/guard";

// Delete or close the account (4.7). An auth-layout page, not nested under /account (the
// `account_` name). Which version shows is decided on the server; the data layer re-checks on write.
export const Route = createFileRoute("/account_/close")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    return { page: await getClosePage() };
  },
  loader: ({ context }) => context.page,
  head: () => ({ meta: [{ title: "Close your account · Kerb" }] }),
  component: Close,
});

function Close() {
  return <ClosePage data={Route.useLoaderData()} />;
}
