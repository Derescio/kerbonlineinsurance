import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

import { LandingPage } from "#/features/landing/LandingPage";
import { publicCacheHeaders } from "#/server/cache";

// Vercel's CDN caches the landing HTML with its CSP header for PUBLIC_CACHE_SECONDS, so the
// function runs about once per window, not per visit (3.4, decision 1). Only pages with no user
// content get this. Server-only, because cache.ts reads the server env.
const landingHeaders = createServerOnlyFn(() => publicCacheHeaders());

export const Route = createFileRoute("/_site/")({
  headers: () => landingHeaders(),
  component: LandingPage,
});
