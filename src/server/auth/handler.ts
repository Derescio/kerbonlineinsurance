import type { Auth } from "./auth";

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
