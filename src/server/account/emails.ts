import { jobDeps } from "#/server/jobs/deps";
import type { JobDeps } from "#/server/jobs/types";

// How the account emails go out (4.7 call 18, moved onto jobs in 4.11): each is an email job
// queued in the change's transaction, then run after the commit and the response (runSoon). A
// failed send is retried by the jobs cron and logged by class name only, never shown.

export type AccountDeps = JobDeps;

/** Resend and waitUntil, the jobs' own (built on first use) */
export function accountDeps(): AccountDeps {
  return jobDeps();
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "7 December 2026", in UK time */
export function formatClosureDate(date: Date): string {
  return DATE.format(date);
}
