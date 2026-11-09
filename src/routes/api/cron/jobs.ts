import { createFileRoute } from "@tanstack/react-router";

import { jobsDb } from "#/server/data/job-rows";
import { cronRoute } from "#/server/jobs/cron-route";
import { jobDeps } from "#/server/jobs/deps";
import { runDueJobs } from "#/server/jobs/runner";

// The jobs retry run (4.11, decision 1), called by Vercel Cron (vercel.json) every 6 hours: runs
// every job whose retry time has come. Jobs normally run straight after the request that queued
// them; this is the safety net. GET only, as Vercel Cron calls it.

export const Route = createFileRoute("/api/cron/jobs")({
  server: {
    handlers: { GET: cronRoute("jobs", (now) => runDueJobs(jobsDb(), jobDeps(), now)) },
  },
});
