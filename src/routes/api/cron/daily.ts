import { createFileRoute } from "@tanstack/react-router";

import { jobsDb } from "#/server/data/job-rows";
import { cronRoute } from "#/server/jobs/cron-route";
import { queueDailyJobs } from "#/server/jobs/daily";
import { jobDeps } from "#/server/jobs/deps";
import { runDueJobs } from "#/server/jobs/runner";

// The daily run (4.11, spec call 6), called by Vercel Cron (vercel.json) at 03:00 UTC: queues the
// day's jobs (closures, uploads cleanup, housekeeping, audit anchor; once per day by their keys),
// then runs them with any other due job. GET only, as Vercel Cron calls it.

export const Route = createFileRoute("/api/cron/daily")({
  server: {
    handlers: {
      GET: cronRoute("daily", async (now) => {
        const queued = await queueDailyJobs(jobsDb(), now);
        return { queued, ...(await runDueJobs(jobsDb(), jobDeps(), now)) };
      }),
    },
  },
});
