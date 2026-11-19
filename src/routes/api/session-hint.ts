import { createFileRoute } from "@tanstack/react-router";

import { sessionHintResponse } from "#/server/auth/session-hint";

// The public header's "My account" (6.1, decision 8): uncached, so the pages can stay cached
export const Route = createFileRoute("/api/session-hint")({
  server: {
    handlers: { GET: ({ request }) => sessionHintResponse(request.headers) },
  },
});
