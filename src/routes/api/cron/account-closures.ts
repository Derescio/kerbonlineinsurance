import { createFileRoute } from "@tanstack/react-router";

import { accountDeps } from "#/server/account/emails";
import { runClosures } from "#/server/account/run-closures";
import { logSafeError } from "#/server/auth/errors";
import { isCronAuthorized } from "#/server/cron-auth";
import { accountDb } from "#/server/data/account";
import { getCronSecret } from "#/server/env";

// The daily account-closure job (4.7, call 14), called by Vercel Cron (vercel.json) at 03:00 UTC.
// Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else gets 401. GET only, as Vercel
// Cron calls it. 4.11 moves the job onto the jobs table.

const noStore = { "Cache-Control": "no-store" };

async function handle({ request }: { request: Request }): Promise<Response> {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch (error) {
    console.error("[cron] account-closures:", logSafeError(error));
    return Response.json({ error: "not configured" }, { status: 500, headers: noStore });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const counts = await runClosures(accountDb(), new Date(), accountDeps());
    return Response.json(counts, { headers: noStore });
  } catch (error) {
    // Its name and SQLSTATE only: a raw message can carry an email
    console.error("[cron] account-closures:", logSafeError(error));
    return Response.json({ error: "failed" }, { status: 500, headers: noStore });
  }
}

export const Route = createFileRoute("/api/cron/account-closures")({
  server: { handlers: { GET: handle } },
});
