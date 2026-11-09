# 4.11 Background jobs

**Status:** approved (Damion, 9 Nov 2026). Plan in [11-background-jobs-plan.md](11-background-jobs-plan.md)
**Phase:** 04-data-auth

## Goal

Work that happens after a request, or on a schedule, goes through one place: the `jobs` table (4.2). A job is never lost and never runs for a change that rolled back. A failure is retried later, and a job that keeps failing is kept with its error, not dropped.

- **Fast in the normal case.** A job runs straight after the response with `waitUntil`, as the emails do today.
- **Retried when it fails.** A cron every 6 hours picks up failed jobs whose retry time has come.
- **Quiet in between.** Nothing calls the database more often than every 6 hours, so Neon can sleep when nobody is using the site.
- **One daily run.** Account closures, the upload cleanup, clearing expired rows and the audit anchor become jobs, queued by one daily cron.
- **The audit chain is anchored.** Each day the newest audit hash is written to R2 under a lock rule, which closes the gap 4.5b left (deleting the newest rows, or rolling the database back).

## Decisions

1. **The retry cron runs every 6 hours** (Damion, 9 Nov 2026). `/api/cron/jobs`, schedule `0 */6 * * *`.
   - **Why not every minute (engineering.md §11):** a query every minute keeps Neon's compute awake around the clock, which is most of the database bill on a site with little traffic. Jobs run straight away with `waitUntil` anyway, so the cron is only a safety net.
   - engineering.md §11 is updated to match.
2. **Dead jobs wait for the admin area** (Damion, 9 Nov 2026). No page in 4.11. A dead job stays in the table with its `last_error`, readable in Neon or Drizzle Studio. The dead-job view comes with the admin area in Phase 6.
3. **The audit anchors are locked in R2** (Damion, 9 Nov 2026). A bucket lock rule on `audit-anchors/` in `kerb-dev` and `kerb-prod`, kept 365 days. The app's token can write a new anchor but can't overwrite or delete one. Only someone logged into Cloudflare can remove the rule. See [What you set up](#what-you-set-up).

## Calls I've made (check these)

4. **Backoff: 6 h, 12 h, 24 h, 48 h** (Damion deferred to me).
   - **Attempt 1** is the `waitUntil` run. Attempts 2–5 wait 6, 12, 24 and 48 hours after the failure before them. A job that fails all 5 is `dead` about 4 days after it was queued.
   - **In practice:** the cron runs every 6 hours, so a retry happens at the first cron run after its time.
   - **Why this long:** an outage (Resend, R2) gets days to be noticed and fixed before anything is given up.
   - A pure function, `nextRunAfter(attempts, now)`, unit tested.
5. **Expired links aren't sent late.**
   - **Which emails:** a reset link lasts 1 hour and a verification link 6 hours, so a retry can come after the link has died.
   - **What happens:** each email job carries its link's `expiresAt`. If that has passed, the job ends `done` with `last_error` set to `skipped: link expired`, not `dead`, so it doesn't look like an outage. The person can still press Resend or ask for another reset, as today.
6. **One daily cron replaces the two** (account closures at 03:00, uploads cleanup at 03:30).
   - **The route:** `/api/cron/daily`, at 03:00 UTC.
   - **What it does:** it queues the day's jobs, each with a key for the date (`account.closures:2026-11-09`), then runs them in this order:
     1. `account.closures`
     2. `uploads.cleanup`
     3. `housekeeping.expired_rows`
     4. `audit.anchor`
   - **Queuing twice does nothing:** the unique key makes a second cron call, or a manual run on the same day, a no-op.
   - **Removed:** `/api/cron/account-closures` and `/api/cron/uploads-cleanup`, and their `vercel.json` entries. `vercel.json` ends with two crons: `jobs` and `daily`.
7. **Every transactional email moves onto jobs, not only verification and reset.** One job type, `email.send`, carries a template name, its parameters and `expiresAt` (when it has a link). The email is built when it's sent.
   - **From better-auth (`auth.ts`):** verification, reset, and the "you already have an account" email.
   - **From the account emails (`account/emails.ts`, 4.7):** closure requested, cancelled, held, account closed, account deleted.
   - **Idempotent sends:** the job's key goes to Resend as its `Idempotency-Key`, so a job that ran twice within Resend's 24 hours sends one email. After 24 hours a second send is possible, but only if Resend accepted an email and then failed to answer. That's acceptable for these emails.
8. **Where the job is queued.**
   - **Account emails and the daily jobs:** inside the same transaction as the change (the outbox). The `waitUntil` run starts after the commit.
   - **better-auth's emails:** better-auth writes its own rows, outside our transactions, so the job is queued after them inside `waitUntil`, as the send is today.
     - **Why not awaited in the request:** the response must take the same time whether or not the email has an account (4.4b). An awaited insert would show the difference.
     - **The cost:** if the function dies before the insert, that email is lost, as it is today. The person can press Resend.
9. **The job row keeps as little personal data as it can.**
   - **When a job finishes:** its `payload` is emptied (`{}`). An email job's payload holds an address and a link that can sign someone in or reset their password.
   - **Clearing old rows:** `housekeeping.expired_rows` deletes `done` jobs after 7 days and `dead` jobs after 30 days.
   - The data contract already drops `payload` (4.2).
10. **How the runner takes a job.**
    - **Claiming:** one `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` moves a job to `running` and adds 1 to `attempts`, so two runners never take the same job.
    - **What gets picked up:**
      - `queued` and `failed` jobs whose `run_after` has passed;
      - `running` jobs not updated for 15 minutes, whose function died mid-run. Those count as a failed attempt.
    - **Each job runs alone:** the handler gets the job, and a thrown error marks only that job `failed` (or `dead` at 5), with `last_error` from `logSafeError` (class name and SQLSTATE only, never a raw message).
    - **Limits per run:** the cron takes up to 50 jobs and stops starting new ones after 45 seconds.
    - **The `waitUntil` run** takes its one job by id, and only if it's still `queued`.
11. **The audit anchor.**
    - **What's written:** the newest `audit_log` row as `audit-anchors/YYYY-MM-DD.json` in that environment's bucket, holding `lastId`, `lastHash`, `keyVersion` and `anchoredAt`. It reads only the newest row, never the whole chain.
    - **If the day's anchor already exists:** the lock refuses an overwrite, so the handler checks with `head` first and ends `done`.
    - **An empty chain:** nothing to anchor, so it ends `done`.
    - **Storage:** `ObjectStore` gains `putObject(key, body, contentType)` for this small server-side write. Uploads still go from the browser with signed links.
12. **`vp run audit:verify` checks the anchors too.**
    - **The chain:** it walks the chain with `verifyAuditChain`.
    - **Each anchor:** it reads every object under `audit-anchors/`. The row with that `lastId` must still exist and have the same hash.
    - **The newest row:** its id must be at least the newest anchor's `lastId`.
    - **The result:** it names the first problem: `anchor_row_missing`, `anchor_hash_mismatch`, or the chain's own reasons. 6.8's "Verify chain" button reuses the same function, `verifyAgainstAnchors`.
13. **`housekeeping.expired_rows` clears 4.5c's leftovers** (4.5c call 20). It deletes:
    - expired `idempotency_keys`;
    - `rate_limits` windows older than a day;
    - old `done` and `dead` jobs (call 9).
14. **Off production.** Vercel Cron only calls production, so two scripts do the same by hand (`NOW=` works, as today):
    - `vp run jobs:run` runs due jobs;
    - `vp run jobs:daily` queues the day's jobs and runs them.

    They replace `account:run-closures` and `uploads:cleanup`.
15. **Both cron routes work as today's do:**
    - `GET` only;
    - `CRON_SECRET` as a Bearer header, through `isCronAuthorized`: anything else gets 401, and an unset secret gets 500;
    - `no-store`;
    - a failure is logged through `logSafeError`.

## In scope

- **Server:** `src/server/jobs/`:
  - `enqueue(tx, { type, payload, idempotencyKey, runAfter? })`, which does nothing on a duplicate key;
  - `runJob(id)`, `runDueJobs(now)`, `nextRunAfter`;
  - the handler registry: `email.send`, `account.closures`, `uploads.cleanup`, `housekeeping.expired_rows`, `audit.anchor`;
  - `queueDailyJobs(now)`.
- **Emails:** `auth.ts`'s `deliver` and `account/emails.ts`'s `sendLater` queue an `email.send` job instead of sending; the Resend idempotency key; the expiry check.
- **Storage:** `putObject` on `ObjectStore` (R2 and the in-memory fake).
- **Audit:** the anchor handler, `verifyAgainstAnchors`, and the `audit:verify` script.
- **Routes:** `/api/cron/jobs` and `/api/cron/daily`. The two old cron routes and their scripts are removed, and `vercel.json` is updated.
- **Docs:**
  - engineering.md §11 (6-hour cron, backoff, daily cron, the job list), plus the cron notes in §6 (uploads) and the 4.7 closure section;
  - the 4.5b limitation note in `verify.ts` and engineering.md, now that the anchor exists;
  - `plan/dev-database.md`: running jobs on dev.

## Out of scope

- The dead-job view and a "retry" button (Phase 6, decision 2).
- Alerts on dead jobs (8.6).
- The other jobs engineering.md lists: claim status emails, the review AI check (7.7), Kerbie summaries and analytics events arrive with their features, as new handlers.
- Cleaning up accounts that are never confirmed (4.4b left it open). It can be added later as another daily handler.

## What you set up

1. **R2 bucket lock rules**, once per bucket (`kerb-dev`, then `kerb-prod`):
   - **Where:** R2 Object Storage → the bucket → **Settings** → **Bucket lock rules** → **Add rule**;
   - **Rule name:** `audit-anchors`;
   - **Prefix:** `audit-anchors/` (with the slash);
   - **Retention:** by age, 365 days.

   They must be in place before the first anchor is written, on dev during the manual check and on production at release.
2. **Nothing else.** No new env variables: the routes use `CRON_SECRET`, and the anchor uses the existing `R2_*` values.

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | `nextRunAfter`: 6, 12, 24, 48 h after attempts 1–4, and `dead` after 5; the expiry check on email payloads | yes |
| Integration | A job queued in a transaction that rolls back leaves no row; a duplicate idempotency key queues one job | yes |
| Integration | A failing job retries with backoff and lands in `dead` after 5 attempts (`NOW` moved forward), with `last_error` set and no raw message | yes |
| Integration | A handler run twice has one effect (the daily jobs; an email job with a fake sender sees one send per key) | yes |
| Integration | Two runners at once never take the same job (`SKIP LOCKED`); a `running` job not updated for 15 minutes is picked up again and counts as an attempt | yes |
| Integration | An expired reset email ends `done` (`skipped: link expired`) without a send; a finished job's payload is `{}` | yes |
| Integration | `queueDailyJobs` twice on one day queues four jobs; closures and cleanup behave as their 4.7 and 4.10 tests expect when run as jobs | yes |
| Integration | Housekeeping deletes expired keys, old rate-limit windows, `done` jobs after 7 days and `dead` after 30, and keeps the rest | yes |
| Integration | With the fake store: the anchor writes the newest row's id and hash; a second run the same day is a no-op; `verifyAgainstAnchors` passes, then names `anchor_row_missing` after the newest rows are deleted and `anchor_hash_mismatch` after one is altered | yes |
| Integration | Both cron routes refuse a missing or wrong `CRON_SECRET` (401) and give 500 when it's unset | yes |
| Integration | Sign-up, reset and the account emails queue an `email.send` job with the right template, and the existing auth and account email tests still pass | yes |
| Manual | On staging and dev: sign up, and the verification email arrives; with `RESEND_API_KEY` deliberately wrong locally, the job is `failed` with a retry time; `vp run jobs:daily` writes today's anchor to `kerb-dev`, and a second write to the same key is refused by the lock; `vp run audit:verify` passes | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The manual check above passes, and the results are recorded here before the PR is merged.
- [ ] `vercel.json` has the two crons, and staging builds with them.

## Commit message

`feat: background jobs with an outbox, retries every 6 hours with backoff, emails and the daily cleanups moved onto it, and a daily audit anchor locked in R2`

## Sources

**Plan:**
- phase.md 4.11 row and testing row;
- engineering.md §11 (background processing);
- 4.4 and 4.4b (emails after the response, no account enumeration);
- 4.5 decision 4 and 4.5b decision 6 (the anchor);
- 4.5c call 20 (clearing expired rows);
- 4.7 call 14 (the closures cron);
- 4.10 call 12 (the uploads cleanup).

**Outside:**
- Vercel Cron and `waitUntil` (`@vercel/functions`);
- Neon scale to zero;
- Cloudflare R2 bucket locks;
- Resend idempotency keys.
