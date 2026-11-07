import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

import { CookiesPage } from "#/features/legal/CookiesPage";
import { publicCacheHeaders } from "#/server/cache";

// CDN-cached like /privacy: the same HTML for everyone, and no closure banner in it.
const cookiesHeaders = createServerOnlyFn(() => publicCacheHeaders());

export const Route = createFileRoute("/_site/cookies")({
  headers: () => cookiesHeaders(),
  head: () => ({ meta: [{ title: "Cookies · Kerb" }] }),
  component: CookiesPage,
});
