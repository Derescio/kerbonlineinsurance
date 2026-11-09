import { createFileRoute } from "@tanstack/react-router";

import { logSafeError } from "#/server/auth/errors";
import { isCronAuthorized } from "#/server/cron-auth";
import { uploadsDb } from "#/server/data/file-rows";
import { getCronSecret } from "#/server/env";
import { runUploadsCleanup } from "#/server/uploads/cleanup";
import { getObjectStore } from "#/server/uploads/store";

// The daily uploads cleanup (4.10, call 12), called by Vercel Cron (vercel.json) at 03:30 UTC,
// after the closures. Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else gets 401.
// GET only, as Vercel Cron calls it. 4.11 moves the job onto the jobs table.

const noStore = { "Cache-Control": "no-store" };

async function handle({ request }: { request: Request }): Promise<Response> {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch (error) {
    console.error("[cron] uploads-cleanup:", logSafeError(error));
    return Response.json({ error: "not configured" }, { status: 500, headers: noStore });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const counts = await runUploadsCleanup(uploadsDb(), getObjectStore(), new Date());
    return Response.json(counts, { headers: noStore });
  } catch (error) {
    // Its name and SQLSTATE only: a raw message can carry an object key
    console.error("[cron] uploads-cleanup:", logSafeError(error));
    return Response.json({ error: "failed" }, { status: 500, headers: noStore });
  }
}

export const Route = createFileRoute("/api/cron/uploads-cleanup")({
  server: { handlers: { GET: handle } },
});
