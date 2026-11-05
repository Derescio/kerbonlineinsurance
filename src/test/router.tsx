import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { render } from "vitest-browser-react";

import { Toaster } from "#/components/feedback/Toaster";

/**
 * Renders a component that uses TanStack Router's Link or useNavigate (and toasts), in a memory
 * router. Returns the router so a test can check where it navigated.
 */
export async function renderWithRouter(ui: ReactNode, initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <Toaster>{ui}</Toaster> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  return { router, screen };
}
