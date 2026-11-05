import { createFileRoute } from "@tanstack/react-router";

import { handleAuthRoute } from "#/server/auth/handler";

// Better Auth's endpoints (4.4): sign-up, sign-in, Google's callback, verification, reset, sessions.
async function handle({ request }: { request: Request }) {
  return handleAuthRoute(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
