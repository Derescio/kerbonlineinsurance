import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Toaster } from "#/components/feedback/Toaster";
import { Route as BillingRoute } from "#/routes/account_.billing";

import { getBillingPortal } from "./billing";
import { Overview } from "./Overview";
import { policy } from "./overview.fixtures";

// /account/billing makes a Stripe customer-portal session each time it loads (5.6b, decision 9),
// and the router preloads a link's route on hover. Hovering the Overview's "Manage payments" (6.1), or any
// preload of the route, must never make one: only going there does.

vi.mock("./billing", () => ({
  getBillingPortal: vi.fn(),
  NO_MONTHLY_CARD: "You don’t pay monthly, so there’s no card to update.",
}));
vi.mock("#/features/auth/guard", () => ({ requireSignedIn: vi.fn() }));
vi.mock("#/features/auth/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("./closure", () => ({ getClosureBanner: vi.fn().mockResolvedValue(null) }));

const portal = vi.mocked(getBillingPortal);

beforeEach(() => {
  vi.clearAllMocks();
  portal.mockResolvedValue({ kind: "no_monthly" });
});

async function showAccount() {
  const rootRoute = createRootRoute({
    component: () => (
      <Toaster>
        <Overview
          name="Alex Morgan"
          policies={[policy({ monthly: true })]}
          nextPayment={{ kind: "due", amountPence: 4_470, dueOn: "2026-12-01" }}
        />
      </Toaster>
    ),
  });
  const billing = BillingRoute.update({
    id: "/account_/billing",
    path: "/account/billing",
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([billing]),
    history: createMemoryHistory({ initialEntries: ["/account"] }),
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
  await router.load();
  await render(<RouterProvider router={router} />);
  return router;
}

describe("Manage payments never makes a portal session on a preload", () => {
  it("doesn't preload when the link is hovered or focused", async () => {
    await showAccount();
    const link = page.getByRole("link", { name: "Manage payments" });
    await userEvent.hover(link);
    link.element().focus();
    // Give an intent preload (no delay configured) time to start
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(portal).not.toHaveBeenCalled();
  });

  it("doesn't make one when the route is preloaded, only when it's loaded", async () => {
    const router = await showAccount();
    await router.preloadRoute({ to: "/account/billing" });
    expect(portal).not.toHaveBeenCalled();
    await router.navigate({ to: "/account/billing" });
    await expect.poll(() => portal.mock.calls.length).toBe(1);
  });
});
