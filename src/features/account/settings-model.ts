import { z } from "zod";

import type { SecurityEventType } from "#/server/db/schema/values";

// Account settings (6.3): the mobile rule, and how Recent activity names and dates each event.

export const MOBILE_ERROR = "Enter a UK mobile number, like 07700 900418";

/**
 * A UK mobile, `07` or `+44 7` and 9 more digits, spaces allowed (decision 4). Stored as
 * "07700 900418"; blank clears it.
 */
export const mobileSchema = z
  .string()
  .transform((raw) => raw.replace(/\s+/g, ""))
  .refine((digits) => digits === "" || /^(?:07|\+447)\d{9}$/.test(digits), MOBILE_ERROR)
  .transform((digits) => {
    if (digits === "") return null;
    const national = digits.startsWith("+44") ? `0${digits.slice(3)}` : digits;
    return `${national.slice(0, 5)} ${national.slice(5)}`;
  });

const LABELS: Record<SecurityEventType, string> = {
  sign_up: "Account created",
  sign_in: "Signed in",
  sign_in_failed: "Failed sign-in attempt",
  sign_in_unverified: "Sign-in before email was confirmed",
  rate_limited: "Too many attempts",
  sign_out: "Signed out",
  password_reset_requested: "Password reset requested",
  password_reset: "Password reset",
  email_verified: "Email confirmed",
  google_linked: "Google connected",
  google_link_refused: "Google couldn't be connected",
  password_removed_on_link: "Password removed when Google was connected",
  two_factor_enabled: "Two-factor turned on",
  two_factor_disabled: "Two-factor turned off",
  backup_codes_regenerated: "New backup codes made",
  two_factor_passed: "Two-factor code accepted",
  two_factor_failed: "Wrong two-factor code",
  signed_out_everywhere: "Signed out everywhere",
  sessions_revoked_on_password_change: "Other devices signed out after a password change",
};

export function activityLabel(type: SecurityEventType, method: string | null): string {
  if (type === "sign_in" && method === "google") return "Signed in with Google";
  return LABELS[type];
}

const WARNINGS: ReadonlySet<SecurityEventType> = new Set([
  "sign_in_failed",
  "rate_limited",
  "two_factor_failed",
  "google_link_refused",
]);

/** Shown in the warning colour, as the frame's failed row */
export function isWarningActivity(type: SecurityEventType): boolean {
  return WARNINGS.has(type);
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/London",
});
const LONDON_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});
const LONDON_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

/** London calendar days from `at` to `now` (0 is the same day) */
function londonDaysBetween(at: Date, now: Date): number {
  const day = (d: Date) => Date.parse(`${LONDON_DAY.format(d)}T00:00:00Z`);
  return Math.round((day(now) - day(at)) / 86_400_000);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "Just now", "12 minutes ago", "2 hours ago", "Yesterday, 21:14" or "12 Nov 2026", in London time */
export function activityWhen(at: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return plural(minutes, "minute");
  const days = londonDaysBetween(at, now);
  if (days === 0) return plural(Math.floor(minutes / 60), "hour");
  if (days === 1) return `Yesterday, ${LONDON_TIME.format(at)}`;
  return LONDON_DATE.format(at);
}
