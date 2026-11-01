import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import { SiteLayout } from "#/components/site/SiteLayout";

// Pathless layout: the site chrome around every public page. /system stays outside it.
export const Route = createFileRoute("/_site")({ component: Site });

function Site() {
  const { pathname } = useLocation();
  return (
    <SiteLayout pathname={pathname}>
      <Outlet />
    </SiteLayout>
  );
}
