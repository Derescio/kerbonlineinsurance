import type { Actor } from "./actor";

// One Actor per request (6.1, from 4.5). A page that calls several server functions reads the
// session and the database once. The request object is the key, so nothing outlives the request:
// a deactivation or a sign-out still applies on the next one. A failed read isn't kept.

const byRequest = new WeakMap<Request, Promise<Actor | null>>();

export function actorForRequest(
  request: Request,
  load: () => Promise<Actor | null>,
): Promise<Actor | null> {
  const known = byRequest.get(request);
  if (known) return known;
  const pending = load().catch((error: unknown) => {
    byRequest.delete(request);
    throw error;
  });
  byRequest.set(request, pending);
  return pending;
}
