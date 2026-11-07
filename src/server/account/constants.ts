// Account closure numbers, in one place (4.7). No imports: the cron runner and scripts load this
// file on its own. `account/constants.test.ts` checks OPEN_CLAIM_STATUSES against `claimStatuses`.

/** How long a closure request waits before the account is closed */
export const CLOSURE_WINDOW_DAYS = 30;

/** Illustrative retention periods, shown on /privacy. Not legal advice. */
export const RETENTION = { insuranceRecordsYears: 7, securityEventsMonths: 12 } as const;

/**
 * The rule for request, cancel and delete (seconds, then attempts). Each action has its own bucket
 * with this rule (account.close, account.keep, account.delete), so they don't share one count.
 */
export const CLOSE_LIMIT = { window: 60 * 60, max: 5 } as const;

/** Claims in these statuses hold a closure. Drafts are discarded; settled and declined are over. */
export const OPEN_CLAIM_STATUSES = ["received", "assessing", "approved"] as const;

/** The controller's contact (decision 6), on /privacy and in the closure emails */
export const PRIVACY_EMAIL = "privacy@kerb.opsedsolutions.com";
