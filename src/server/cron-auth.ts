import { createHash, timingSafeEqual } from "node:crypto";

// Vercel Cron's check (4.7 call 14, shared with 4.10's cleanup): the request must carry
// `Authorization: Bearer <CRON_SECRET>`. Compares hashes, so the check takes the same time
// whatever the header's length or content.

export function isCronAuthorized(header: string | null, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
