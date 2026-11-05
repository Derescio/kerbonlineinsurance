import { createFileRoute } from "@tanstack/react-router";

import { getAuth } from "#/server/auth/auth";
import { handleAuthRequest } from "#/server/auth/handler";
import { recordSecurityEvent } from "#/server/auth/security-events";
import { getDb } from "#/server/db/client";
import { getAuthEnv } from "#/server/env";

// Better Auth's endpoints (4.4): sign-up, sign-in, Google's callback, verification, reset, sessions.
async function handle({ request }: { request: Request }) {
  return handleAuthRequest(getAuth(), request, (headers) =>
    recordSecurityEvent(getDb(), getAuthEnv().BETTER_AUTH_SECRET, {
      type: "rate_limited",
      headers,
    }),
  );
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
