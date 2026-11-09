# 4.11 Background jobs: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece of after-the-request or scheduled work becomes a row in `jobs`, queued in the same transaction where we own it. The row is run straight away with `waitUntil`, retried by a 6-hourly cron with 6/12/24/48 h backoff, and `dead` after 5 attempts. The emails, account closures, uploads cleanup, expired-row housekeeping and a daily audit anchor in R2 all run this way.

**Architecture:** There are four layers.
1. **The core** in `src/server/jobs/`: pure backoff, then `enqueue`, then a runner. The runner claims one row at a time with an atomic `UPDATE … RETURNING`, calls the handler for its `type` and records the outcome.
2. **Handlers:** each lives next to the code it drives and is registered in `src/server/jobs/handlers.ts`.
3. **The email path:** emails become `email.send` jobs that carry a template name and its parameters, and the message is built at send time.
4. **The outside:** two cron routes and one script call the same `queueDailyJobs` and `runDueJobs`.

**Tech Stack:** TypeScript, Drizzle on `pg`, `@vercel/functions` `waitUntil`, Resend 6.37 (`idempotencyKey`), `@aws-sdk/client-s3` (`PutObject`, `GetObject`, `ListObjectsV2`), Zod 4, and the Vitest `unit` and `integration` projects.

**Spec:** [11-background-jobs.md](11-background-jobs.md). Read decisions 1–3 and calls 4–15 before starting.

## Global Constraints

- **Statuses:** `queued`, `running`, `done`, `failed`, `dead` (already in `jobStatuses`). No migration: the `jobs` table from 4.2 is used as it is.
- **Job types:** `email.send`, `account.closures`, `uploads.cleanup`, `housekeeping.expired_rows`, `audit.anchor`.
- **Backoff:** 5 attempts at most. After a failed attempt *n* (1–4), wait 6, 12, 24 or 48 hours; after a 5th failed attempt, `dead`.
- **Stale `running`:** a job not updated for 15 minutes is taken again.
- **Per cron run:** at most 50 jobs, and no new job starts after 45 s.
- **Clearing old rows:** `done` jobs after 7 days, `dead` jobs after 30 days, `rate_limits` windows older than 1 day, and `idempotency_keys` past `expires_at`.
- **Daily keys:** `<type>:<YYYY-MM-DD>` in UTC. Daily order: `account.closures`, `uploads.cleanup`, `housekeeping.expired_rows`, `audit.anchor`.
- **Crons in `vercel.json`:** `/api/cron/jobs` at `0 */6 * * *`, and `/api/cron/daily` at `0 3 * * *`. No others.
- **Anchor object:** `audit-anchors/YYYY-MM-DD.json` holding `{ lastId, lastHash, keyVersion, anchoredAt }`, with content type `application/json`.
- **`last_error`:**
  - **On a failure:** `logSafeError(error)` rendered as `Name` or `Name (SQLSTATE)`, and nothing else. No message, address, key or URL.
  - **On a skip:** the handler's reason, e.g. `skipped: link expired`.
- **Payloads:** a finished job's `payload` is `{}`. A `failed` or `dead` job keeps its payload.
- **Time:** everything takes a `now: Date` and uses it, never SQL `now()`, so `NOW=` and the tests can move time.
- **Process:** stage files by name. No `vp build` or browser tests while Damion's `vp dev` is running without telling him first.

## Calls this plan makes (for Damion to check)

- **P1. `JobDeps` is today's `AccountDeps`:** `{ sendEmail, defer }`. `AccountDeps` becomes an alias, so the account and auth tests keep their fake sender and `sent` array, and still see the emails after they flush what was deferred.
- **P2. Account emails run straight away.** Inside a closure or delete, the email job is queued in the transaction. After the commit, `deps.defer(runJob(db, id, deps))` runs it. In a daily run, the cron's next loop pass would pick it up anyway; the claim is atomic, so only one of the two sends it.
- **P3. The scripts don't send email by default.** `vp run jobs:run` and `vp run jobs:daily` count email jobs and drop them, as `account:run-closures` does today, and the dropped jobs end `done` with `skipped: email off in scripts`. `SEND_EMAILS=1` sends through Resend for real.
- **P4. One script, two commands:** `scripts/jobs.ts run|daily`, and a separate `scripts/audit-verify.ts`.
- **P5. `ObjectStore` gains three methods:** `putObject`, `getText` and `list`. `verifyAgainstAnchors` needs to list and read the anchors, not only write them.
- **P6. One shared cron helper:** `cronRoute(label, work)` in `src/server/jobs/cron-route.ts` holds the secret check, `no-store` and logging. The two old routes each had their own copy.

## Review Focus

1. **The `waitUntil` run and a cron run reaching the same job.** Only one runs it, because `runJob` claims only a `queued` row whose time has come. Test in Task 2: `Promise.all([runJob(id), runDueJobs()])` calls the handler once.
2. **A function killed mid-job.** The row is left `running`. After 15 minutes it's taken again and counts as an attempt; at 5 attempts it goes `dead` instead of running a 6th time. Test in Task 2.
3. **An unknown type or a bad payload** (an old row after a rename). That job fails and ends `dead`, and the jobs after it still run. Test in Task 2.
4. **The cron, then the script, on the same day.** Neither the closures, the cleanup nor the anchor runs a second time. Test in Task 4 (`queueDailyJobs` twice) and Task 5 (an anchor that exists already).
5. **A failed email never puts the address in `last_error`.** Test in Task 3: a sender that throws `new Error("bad to: maya.patel@example.com")` leaves `last_error` equal to `Error`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/server/jobs/backoff.ts` (+ `.test.ts`) | `MAX_ATTEMPTS`, `STALE_AFTER_MS`, `nextRunAfter`, `dayKey` |
| `src/server/jobs/enqueue.ts` | `enqueue` |
| `src/server/jobs/runner.ts` | `runJob`, `runDueJobs`, the claim and finish SQL |
| `src/server/jobs/types.ts` | `JobType`, `JobRow`, `JobDeps`, `Handler`, `HandlerResult` |
| `src/server/jobs/handlers.ts` | the registry: type → handler |
| `src/server/jobs/runner.int.test.ts` | runner tests with fake handlers |
| `src/server/jobs/email.ts` (+ `.int.test.ts`) | `queueEmail`, the `email.send` handler, `runSoon` |
| `src/server/email/registry.ts` (+ `.test.ts`) | `EMAIL_TEMPLATES`, `EmailTemplate`, `renderEmail` |
| `src/server/jobs/daily.ts` (+ `.int.test.ts`) | `queueDailyJobs`, the closures, cleanup and housekeeping handlers |
| `src/server/audit/anchor.ts` (+ `.int.test.ts`) | the `audit.anchor` handler and `verifyAgainstAnchors` |
| `src/server/jobs/cron-route.ts` | `cronRoute` |
| `src/routes/api/cron/jobs.ts`, `daily.ts` (+ `-cron.int.test.ts`) | the two routes |
| `scripts/jobs.ts`, `scripts/audit-verify.ts` | the hand-run commands |
| removed | `src/routes/api/cron/account-closures.ts`, `uploads-cleanup.ts`, their `-*.int.test.ts`, `scripts/run-closures.ts`, `scripts/uploads-cleanup.ts` |

---

### Task 1: Backoff and enqueue

**Files:**
- Create: `src/server/jobs/backoff.ts`, `src/server/jobs/backoff.test.ts`, `src/server/jobs/types.ts`, `src/server/jobs/enqueue.ts`, `src/server/jobs/enqueue.int.test.ts`

**Interfaces:**
- Produces:
  - `MAX_ATTEMPTS = 5`
  - `STALE_AFTER_MS = 15 * 60_000`
  - `nextRunAfter(attempts: number, now: Date): Date | null`, where `null` means dead
  - `dayKey(now: Date): string`, the UTC `YYYY-MM-DD`
  - `type JobType = "email.send" | "account.closures" | "uploads.cleanup" | "housekeeping.expired_rows" | "audit.anchor"`
  - `type JobRow = typeof jobs.$inferSelect`
  - `type JobStatus = (typeof jobStatuses)[number]`
  - `interface JobDeps { sendEmail: SendEmail; defer: (work: Promise<unknown>) => void }`
  - `type HandlerResult = void | { skipped: string }`
  - `type Handler = (job: JobRow, ctx: { db: Db; deps: JobDeps; now: Date }) => Promise<HandlerResult>`
  - `enqueue(db: Db | Tx, job: { type: JobType; payload: Record<string, unknown>; idempotencyKey: string; runAfter: Date }): Promise<number | null>`, which returns the new id, or `null` when the key exists already

- [ ] **Step 1: Write the failing unit tests** in `backoff.test.ts`:
  - `nextRunAfter(n, t)` is `t` plus 6, 12, 24 and 48 hours for n = 1–4;
  - `nextRunAfter(5, t)` and `nextRunAfter(6, t)` are `null`;
  - `dayKey(new Date("2026-11-09T23:30:00Z"))` is `"2026-11-09"`;
  - `dayKey(new Date("2026-11-10T00:10:00+01:00"))` is `"2026-11-09"`.
- [ ] **Step 2: Run `vp test src/server/jobs/backoff.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `backoff.ts` and `types.ts`.** The delays are a lookup `[6, 12, 24, 48]` hours indexed by `attempts - 1`.
- [ ] **Step 4: Write the failing integration tests** in `enqueue.int.test.ts` (`truncateAll` before each):
  - `enqueue inside a withTx that throws leaves no row`;
  - `a second enqueue with the same key returns null and the table has one row`;
  - `the row is queued, attempts 0, run_after equal to the given date`.
- [ ] **Step 5: Implement `enqueue`** with `insert … on conflict (idempotency_key) do nothing returning id`.
- [ ] **Step 6: Run `vp test src/server/jobs`.** Expected: PASS.
- [ ] **Step 7: Commit:** `feat(jobs): backoff and enqueue for the jobs outbox`

### Task 2: The runner

**Files:**
- Create: `src/server/jobs/runner.ts`, `src/server/jobs/handlers.ts`, `src/server/jobs/runner.int.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type Handlers = Partial<Record<JobType, Handler>>`
  - `runJob(db: Db, id: number, deps: JobDeps, now = new Date(), handlers: Handlers = HANDLERS): Promise<JobStatus | null>`, where `null` means it wasn't claimable
  - `runDueJobs(db: Db, deps: JobDeps, now: Date, opts?: { max?: number; budgetMs?: number; handlers?: Handlers }): Promise<{ ran: number; done: number; failed: number; dead: number }>`
  - `HANDLERS` in `handlers.ts`. It starts empty; Tasks 3–5 add to it.

How the claims work:
- **`runJob` claims by id:** `UPDATE jobs SET status='running', attempts=attempts+1, updated_at=$now WHERE id=$id AND status='queued' AND run_after <= $now RETURNING *`.
- **`runDueJobs` first** marks stale jobs that have no attempts left as `dead` (`running`, `updated_at < now - STALE_AFTER_MS`, `attempts >= MAX_ATTEMPTS`, `last_error = 'timed out'`).
- **Then it loops**, claiming one row per pass with:

  ```sql
  UPDATE jobs SET status='running', attempts=attempts+1, updated_at=$now
  WHERE id = (SELECT id FROM jobs
              WHERE (status IN ('queued','failed') AND run_after <= $now)
                 OR (status = 'running' AND updated_at < $now - interval '15 minutes')
              ORDER BY run_after, id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING *
  ```

  It stops when nothing is returned, at `max` (default 50), or once `budgetMs` (default 45 000) has passed by the wall clock.
- **Finishing** goes through one internal helper for both callers:
  - **success:** `done`, `payload = '{}'`, and `last_error` set to the skip reason or null;
  - **throw:** `nextRunAfter(attempts, now)` gives `failed` with that `run_after`, or `dead` when it returns null. `last_error` is the safe name, and `updated_at = now`.
- **An unknown type** throws `Error("No handler for job type")` and is finished like any other throw.

- [ ] **Step 1: Write the failing tests** in `runner.int.test.ts`, with fake handlers passed through `handlers` and a `now` you move forward:
  - `a failing job retries at 6, 12, 24 and 48 hours and is dead after 5 attempts`. Run `runDueJobs` at each `run_after`: status goes `failed` ×4, then `dead`, with `attempts` 5 and `last_error` `"Error"`. A run one minute before a `run_after` takes nothing.
  - `a successful job is done with payload {} and no last_error`.
  - `a skipped job is done with last_error "skipped: link expired"`.
  - `runJob and runDueJobs at once call the handler once` (Review Focus 1).
  - `two runDueJobs at once never take the same job`: 3 jobs and a handler that counts calls per id; every count is 1.
  - `a running job not updated for 15 minutes is taken again; at 5 attempts it goes dead without running` (Review Focus 2).
  - `an unknown type ends dead after 5 runs and the next job still runs` (Review Focus 3).
  - `runDueJobs stops at max`: 3 due jobs and `max: 2` give `ran: 2`.
  - `runJob on a job that's failed or not yet due returns null and runs nothing`.
- [ ] **Step 2: Run `vp test src/server/jobs/runner.int.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `runner.ts` and an empty `handlers.ts`.**
- [ ] **Step 4: Run `vp test src/server/jobs`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(jobs): runner that claims, retries with backoff and marks jobs dead`

### Task 3: Emails as jobs

**Files:**
- Create: `src/server/email/registry.ts`, `src/server/email/registry.test.ts`, `src/server/jobs/email.ts`, `src/server/jobs/email.int.test.ts`
- Modify:
  - `src/server/email/send.ts`: `SendEmail` gains an optional second argument, `{ idempotencyKey?: string }`, which `resendSender` passes to `resend.emails.send(payload, { idempotencyKey })`;
  - `src/server/jobs/handlers.ts`: register `email.send`;
  - `src/server/auth/auth.ts:68-73`: `deliver`;
  - `src/server/account/emails.ts`: `AccountDeps = JobDeps`, and `sendLater` is removed;
  - `src/server/account/closure.ts`, `delete.ts` and `run-closures.ts`: queue inside the transaction, `runSoon` after the commit.

**Interfaces:**
- Consumes: `enqueue`, `runJob` and `JobDeps`.
- Produces:
  - `EMAIL_TEMPLATES`: `verify_email`, `reset_password`, `existing_account`, `account_deleted`, `closure_requested`, `closure_cancelled`, `closure_held` and `account_closed`, each mapped to today's builder in `templates.ts`;
  - `type EmailTemplate = keyof typeof EMAIL_TEMPLATES`;
  - `renderEmail(template: EmailTemplate, params: Record<string, string>): EmailContent`;
  - `queueEmail(db: Db | Tx, email: { to: string; template: EmailTemplate; params?: Record<string, string>; expiresAt?: Date }, now = new Date()): Promise<number>`, where the key is `email:<randomUUID()>`;
  - `runSoon(db: Db, id: number, deps: JobDeps): void`, which is `deps.defer(runJob(db, id, deps).catch(log))`;
  - `emailHandler: Handler`:
    - it parses the payload with Zod (`to`, `template` in the registry, `params`, optional `expiresAt`);
    - if `expiresAt <= now`, it returns `{ skipped: "link expired" }`;
    - otherwise it calls `deps.sendEmail({ to, ...renderEmail(...) }, { idempotencyKey: job.idempotencyKey })`.

How the emails change:
- **`auth.ts` `deliver(to, template, params, expiresInSeconds?)`:** `deps.defer?.(queueEmail(db, …).then((id) => runJob(db, id, { sendEmail: deps.sendEmail, defer: deps.defer ?? (() => {}) })).catch(log))`.
  - **The calls:** verification passes `6 * 60 * 60`, reset passes `60 * 60`, and "existing account" passes nothing.
  - **Why it isn't awaited:** the insert stays out of the request (spec call 8).
- **The account emails:**
  - **`requestClosure` and `cancelClosure`:** `queueEmail(tx, …)` inside the `defineWrite` callback. The id goes into `done`, and `runSoon` runs after `result.ok`.
  - **`deleteAccount`:** queues inside `withAccountTx`.
  - **`processClosure`:** queues inside its `withTx` and returns the id in the outcome. `runClosures` calls `runSoon` after each commit.

- [ ] **Step 1: Write the failing unit test** in `registry.test.ts`: every template renders a non-empty subject, html and text, and `renderEmail("reset_password", { name: "Maya", url: "https://x/r" }).html` contains `https://x/r`.
- [ ] **Step 2: Write the failing integration tests** in `email.int.test.ts`, with a fake sender that records `(message, opts)`:
  - `an email job sends once with its idempotency key as Resend's`;
  - `an expired link is skipped without a send and ends done with "skipped: link expired"`;
  - `a sender throwing "bad to: maya.patel@example.com" leaves last_error "Error"` (Review Focus 5), with the payload kept;
  - `an unknown template fails`;
  - `a job run twice sends once`: run it, set it back to `queued` as the owner, run it again, and the sender still has one call because its key is the same. This asserts the key is passed on; Resend does the deduplication.
- [ ] **Step 3: Run `vp test src/server/email src/server/jobs/email.int.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement the registry, `email.ts`, the `send.ts` option, and register the handler.**
- [ ] **Step 5: Move the auth and account senders** as described above.
- [ ] **Step 6: Add tests to the existing suites:**
  - `src/server/auth/` sign-up test: after the flush, `jobs` has one `done` `email.send` row and `payload` is `{}`;
  - `account.int.test.ts`: a closure request that rolls back (`ALREADY_CLOSING`) leaves no job.
- [ ] **Step 7: Run `vp test src/server/auth src/server/account src/server/jobs src/server/email`.** Expected: PASS, with every existing `sent` assertion unchanged.
- [ ] **Step 8: Commit:** `feat(jobs): emails sent as jobs with retries, skipped once their link expires`

### Task 4: Daily jobs: closures, cleanup and housekeeping

**Files:**
- Create: `src/server/jobs/daily.ts`, `src/server/jobs/daily.int.test.ts`
- Modify: `src/server/jobs/handlers.ts`; the header comments in `src/server/account/run-closures.ts` and `src/server/uploads/cleanup.ts` (they now run as jobs)

**Interfaces:**
- Consumes: `enqueue`, `dayKey`, `runClosures(db, now, deps)` and `runUploadsCleanup(db, getObjectStore(), now)`.
- Produces:
  - `DAILY_JOBS: readonly JobType[]`, in the order from Global Constraints;
  - `queueDailyJobs(db: Db, now: Date): Promise<number>`, the number newly queued. All four go in one `withTx`, with `run_after = now` and ids in `DAILY_JOBS` order, so `runDueJobs` takes them in that order;
  - the handlers:
    - `closuresHandler` and `cleanupHandler` throw when the result's `failed` is above 0, so the job is retried. Both underlying runs can be repeated safely;
    - `housekeepingHandler` deletes the four kinds of old rows from Global Constraints.

- [ ] **Step 1: Write the failing tests** in `daily.int.test.ts`:
  - `queueDailyJobs twice on one day queues four jobs, and the next day four more`;
  - `a daily run closes a due closure and purges a stale upload`: reuse the factories from `run-closures.int.test.ts` and `cleanup.int.test.ts`, then `runDueJobs` and check that all four are `done`;
  - `a second daily run the same day changes nothing` (Review Focus 4);
  - `housekeeping deletes an expired idempotency key, a 2-day-old rate-limit window, a done job 8 days old and a dead job 31 days old, and keeps a fresh one of each`;
  - `a closures run with a failure leaves the job failed with a retry time`. Make one closure fail the way `run-closures.int.test.ts` already does.
- [ ] **Step 2: Run `vp test src/server/jobs/daily.int.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `daily.ts` and register its three handlers.**
- [ ] **Step 4: Run `vp test src/server/jobs src/server/account src/server/uploads`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(jobs): daily closures, uploads cleanup and housekeeping as jobs`

### Task 5: The audit anchor

**Files:**
- Create: `src/server/audit/anchor.ts`, `src/server/audit/anchor.int.test.ts`, `scripts/audit-verify.ts`
- Modify:
  - `src/server/uploads/store.ts`, `store-r2.ts` and `store-memory.ts`: new methods;
  - `src/server/jobs/handlers.ts`;
  - the limitation comment in `src/server/audit/verify.ts`;
  - `package.json`: `"audit:verify": "node scripts/audit-verify.ts"`.

**Interfaces:**
- Produces, on `ObjectStore`:
  - `putObject(key: string, body: string, contentType: string): Promise<void>`;
  - `getText(key: string): Promise<string | null>`, which is null when missing;
  - `list(prefix: string): Promise<string[]>`, every key, paginated in R2 (`ListObjectsV2`).

  Memory implements them over its map.
- Produces:
  - `ANCHOR_PREFIX = "audit-anchors/"`;
  - `anchorHandler: Handler`:
    - it reads `select id, hash, key_version from audit_log order by id desc limit 1`;
    - with no rows, it returns `{ skipped: "nothing to anchor" }`;
    - if `head` finds the day's key, it returns `{ skipped: "already anchored" }`;
    - otherwise it calls `putObject`;
  - `verifyAgainstAnchors(db: Queryable, store: Pick<ObjectStore, "list" | "getText">): Promise<{ ok: true; anchors: number } | { ok: false; anchor: string; reason: "anchor_unreadable" | "anchor_row_missing" | "anchor_hash_mismatch" }>`, where `anchor` is the object key, never a hash.

- [ ] **Step 1: Write the failing tests** in `anchor.int.test.ts`, with the memory store via `setObjectStore` and audit rows written with `audit()` as in `audit.int.test.ts`:
  - `the anchor holds the newest row's id, hash and key version`;
  - `a second run the same day is skipped and the object is unchanged` (Review Focus 4);
  - `an empty chain is skipped`;
  - `verifyAgainstAnchors passes after an anchor`;
  - `deleting the newest audit row as the owner gives anchor_row_missing`;
  - `altering the anchored row's hash gives anchor_hash_mismatch`;
  - `an anchor that isn't JSON gives anchor_unreadable`.
- [ ] **Step 2: Run `vp test src/server/audit/anchor.int.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the store methods, `anchor.ts`, and register the handler.**
- [ ] **Step 4: Write `scripts/audit-verify.ts`** in the module-runner style of today's `scripts/uploads-cleanup.ts`:
  - it loads `.env.local` and prints the database host and bucket;
  - it runs `verifyAuditChain(getDb().$client, getAuditEnv())`, then `verifyAgainstAnchors`;
  - it prints `Chain OK: N rows. Anchors OK: M.`, or the failing `rowId` or anchor key with its reason, and exits 1 on any failure.
- [ ] **Step 5: Run `vp test src/server/audit src/server/uploads`.** Expected: PASS.
- [ ] **Step 6: Commit:** `feat(audit): daily anchor of the chain's newest hash in R2, checked by audit:verify`

### Task 6: Cron routes and the jobs script

**Files:**
- Create:
  - `src/server/jobs/cron-route.ts`;
  - `src/routes/api/cron/jobs.ts` and `src/routes/api/cron/daily.ts`;
  - `src/routes/api/cron/-cron.int.test.ts`;
  - `scripts/jobs.ts`.
- Modify: `vercel.json`, `package.json` (`"jobs:run": "node scripts/jobs.ts run"` and `"jobs:daily": "node scripts/jobs.ts daily"`).
- Delete: `src/routes/api/cron/account-closures.ts`, `uploads-cleanup.ts` and their `-*.int.test.ts`; `scripts/run-closures.ts` and `scripts/uploads-cleanup.ts`. Remove their `package.json` entries too.

**Interfaces:**
- Consumes: `runDueJobs` and `queueDailyJobs`.
- Produces: `cronRoute(label: string, work: (now: Date) => Promise<object>): (ctx: { request: Request }) => Promise<Response>`, which does what today's routes do:
  - 500 `not configured` when `CRON_SECRET` is unset;
  - 401 when the Bearer header is wrong;
  - the work's result as JSON;
  - 500 `failed` with a `logSafeError` line;
  - always `Cache-Control: no-store`.
- **The production deps:** `jobDeps()` in `jobs/types.ts` holds Resend (`getAuthEnv`) and `waitUntil`, and is built on first use, as `accountDeps()` is today. `accountDeps()` returns `jobDeps()`.
- **The routes:**
  - `jobs` runs `runDueJobs(getDb(), jobDeps(), now)`;
  - `daily` runs `queueDailyJobs(getDb(), now)`, then the same `runDueJobs`, and returns `{ queued, ...counts }`.
- **`scripts/jobs.ts`:**
  - **Startup:** the same as `scripts/run-closures.ts` (the env file, the audit-key check, `DATABASE_URL`, the host line, `NOW=`).
  - **Sender:** a sender that counts and drops unless `SEND_EMAILS=1` (P3).
  - **`defer`:** it collects the promises and awaits them before exiting.
  - **What it prints:** `Ran N: done D, failed F, dead X. Emails not sent: E.`
  - **Exit code:** 1 when `failed + dead > 0`.

- [ ] **Step 1: Write the failing tests** in `-cron.int.test.ts`, carrying over the 401 and 500 tests from the two old route tests for both new routes:
  - `daily with the secret queues and runs the four daily jobs`;
  - `jobs with the secret runs a due failed job`.
- [ ] **Step 2: Run `vp test src/routes/api/cron`.** Expected: FAIL.
- [ ] **Step 3: Implement the helper, the routes, `jobDeps` and the script.** Delete the old files, and set `vercel.json` to exactly the two crons in Global Constraints.
- [ ] **Step 4: Run `vp check && vp test`.** Expected: all pass, with no references left to the deleted files (`grep -rn "account-closures\|uploads-cleanup\|run-closures" src scripts package.json vercel.json` finds nothing).
- [ ] **Step 5: Commit:** `feat(jobs): six-hourly and daily cron routes, and vp run jobs:run / jobs:daily`

### Task 7: Docs, manual check and done-markers

**Files:**
- Modify:
  - `plan/engineering.md`: §11 (the 6-hour cron and why, backoff, the daily cron, the job list with "in place" against "comes later"), §6 (the uploads cleanup runs as a daily job), the 4.7 closure paragraph, and the 4.5b limitation note (the anchor now exists);
  - `plan/dev-database.md`: running jobs on dev (`jobs:run`, `jobs:daily`, `NOW=`, `SEND_EMAILS=1`, `audit:verify`);
  - the slice spec: Status, the manual check results, and Done when;
  - `phase.md`: the 4.11 row;
  - `build-plan.md`: the 4.11 box.

- [ ] **Step 1: Update the docs** listed above. Replace every `account:run-closures` and `uploads:cleanup` in `plan/engineering.md` and `plan/dev-database.md` (leave older slice specs as they are, since they're history).
- [ ] **Step 2: Run `vp check && vp test && vp build`.** Ask Damion first if `vp dev` is running. Expected: PASS.
- [ ] **Step 3: Push, open the PR** with the template, and confirm `ci` and the preview pass.
- [ ] **Step 4: Run the manual check with Damion**, after he's added the `audit-anchors` lock rule to `kerb-dev`:
  1. sign up on staging, and the verification email arrives;
  2. locally with a wrong `RESEND_API_KEY`, sign up and see the job `failed` with a `run_after` 6 h ahead;
  3. `vp run jobs:daily` writes today's anchor to `kerb-dev`;
  4. a second `putObject` to that key is refused by R2;
  5. `vp run audit:verify` passes.
- [ ] **Step 5: Record the results in the spec** and tick Done when. Mark 4.11 done in `phase.md` and `build-plan.md`. Commit and push to the slice branch: check `gh pr view <n> --json state` first, and push only if it's still open.
- [ ] **Step 6: Tell Damion the PR is ready to merge.** Remind him that the `kerb-prod` lock rule is needed before the release.
