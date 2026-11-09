// When a failed job runs again (4.11, spec call 4). Attempt 1 is the waitUntil run straight after
// the request; attempts 2–5 wait 6, 12, 24 and 48 hours after the failure before them. The retry
// cron runs every 6 hours (decision 1), so a retry happens at the first run after its time. A job
// that fails all 5 is dead about 4 days after it was queued.

export const MAX_ATTEMPTS = 5;

/** A `running` job not updated for this long died with its function, and is taken again */
export const STALE_AFTER_MS = 15 * 60_000;

const DELAY_HOURS = [6, 12, 24, 48];

/** When attempt `attempts + 1` may run, or null when the job is dead */
export function nextRunAfter(attempts: number, now: Date): Date | null {
  const hours = DELAY_HOURS[attempts - 1];
  if (attempts >= MAX_ATTEMPTS || hours === undefined) return null;
  return new Date(now.getTime() + hours * 60 * 60_000);
}

/** The UTC date, `YYYY-MM-DD`: the daily jobs' keys and the anchor's object name */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
