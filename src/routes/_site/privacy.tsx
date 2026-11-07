import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

import { PrivacyNotice } from "#/features/legal/PrivacyNotice";
import { publicCacheHeaders } from "#/server/cache";

// CDN-cached like the landing page: the notice holds no user content, and the closure banner is
// loaded in the browser from a private, no-store server function, never rendered into this HTML.
const privacyHeaders = createServerOnlyFn(() => publicCacheHeaders());

export const Route = createFileRoute("/_site/privacy")({
  headers: () => privacyHeaders(),
  head: () => ({ meta: [{ title: "Privacy notice · Kerb" }] }),
  component: PrivacyNotice,
});
