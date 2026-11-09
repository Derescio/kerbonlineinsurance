import { getDb } from "#/server/db/client";
import { getAuthEnv } from "#/server/env";

import { getAuth } from "./auth";
import type { Auth } from "./auth";
import { recordSecurityEvent } from "./security-events";

/**
 * Runs a request through Better Auth. Its limiter answers 429 before any hook runs, so the
 * rate_limited event is recorded here (decision 4). Auth responses are never cached.
 */
export async function handleAuthRequest(
  auth: Auth,
  request: Request,
  onRateLimited: (headers: Headers) => Promise<void>,
): Promise<Response> {
  const response = await auth.handler(request);
  if (response.status === 429) await onRateLimited(request.headers);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The /api/auth/* route's body: Better Auth plus the security-event write, so the route imports no database code. */
export async function handleAuthRoute(request: Request): Promise<Response> {
  return handleAuthRequest(getAuth(), request, (headers) =>
    recordSecurityEvent(getDb(), getAuthEnv().BETTER_AUTH_SECRET, {
      type: "rate_limited",
      headers,
    }),
  );
}
