import { logSafeError } from "#/server/auth/errors";
import { isCronAuthorized } from "#/server/cron-auth";
import { getCronSecret } from "#/server/env";

// What every Vercel Cron route does around its work (4.7 call 14, shared since 4.11): Vercel sends
// `Authorization: Bearer <CRON_SECRET>`, and anything else gets 401; an unset secret is a 500.
// Answers are never cached, and a failure is logged by class name and SQLSTATE only, since a raw
// message can carry an email or an object key.

const noStore = { "Cache-Control": "no-store" };

export function cronRoute(
  label: string,
  work: (now: Date) => Promise<object>,
): (ctx: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    let secret: string;
    try {
      secret = getCronSecret();
    } catch (error) {
      console.error(`[cron] ${label}:`, logSafeError(error));
      return Response.json({ error: "not configured" }, { status: 500, headers: noStore });
    }
    if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    }
    try {
      return Response.json(await work(new Date()), { headers: noStore });
    } catch (error) {
      console.error(`[cron] ${label}:`, logSafeError(error));
      return Response.json({ error: "failed" }, { status: 500, headers: noStore });
    }
  };
}
