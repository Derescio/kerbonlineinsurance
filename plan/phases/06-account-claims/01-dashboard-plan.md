# 6.1 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/account` becomes the Overview inside a shared account shell, settings move to `/account/settings`, and the public header says "My account" when signed in.

**Architecture:** Two new reads in `src/server/data/policies.ts` feed a new `Overview` component rendered inside a new `AccountShell`. The public header asks an uncached `/api/session-hint` route after it loads, so cached HTML never changes. `getActor` is memoised per request through a `WeakMap` keyed by `getRequest()`.

**Tech Stack:** TanStack Start (routes, server functions, server routes), Drizzle + Postgres, Better Auth, Vitest (`vp test`, integration and browser projects), Playwright.

**Spec:** [01-dashboard.md](01-dashboard.md). Figma: Account · Overview `258:3602` (01 `258:3608`, 02 `258:3635`, 03 `258:3659`, 04 `258:3683`).

## Global Constraints

- Branch `slice/6.1-dashboard` (made from `staging`). Stage files by name, never a folder.
- Every commit ends with both lines:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Don't run browser tests or `vp build` while `vp dev` is running (the stale deps cache breaks hydration).
- Copy is verbatim from the spec: "Hi {first}, you're covered." / "Hi {first}"; "Policies", "Next payment", "A year"; "Payment due", "£X outstanding", "on 1 Dec", "All paid for this year", "Manage payments", "after your £X bundle saving"; "Your policies", "Your saved quotes", "Car + home bundle", "You save £X a year"; "Renews {date}", "Ended {date}", "Starts {date}"; "Your payment didn't go through. Update your card to restart your cover."; "You don't have any policies yet.", "Get a quote"; "Account settings", "Log out", "My account", "Overview".
- Dates: Europe/London. The greeting line is `weekday day month` ("Tuesday 18 November"); short dates are "1 Dec" in the stat card and "14 Mar 2027" in rows.
- **Held** = status `active` (starting later included) or `lapsed`. `cancelled` and ended (`endsOn` before today) don't count.
- Not in 6.1: the bell, the Open claims card, the add-product card (6.1b), tabs other than Overview, row links.
- `/account` keeps `private, no-store`. Public pages keep their CDN cache headers.

## Review Focus

1. **A car policy with no registration** (the catalogue path stores `registration` null): the row shows "{make} {model}" with no plate. Test in Task 1 and Task 6.
2. **A signed-in user with no customer row** (signed up, never saved a quote): the Overview renders the empty state, and the reads return `[]` and `{ kind: "none" }`, not an error. Test in Task 1.
3. **"Today" near midnight:** a payment due today counts as next, not overdue, using the Europe/London date even when UTC is already tomorrow. Test in Task 1 with an injected `now`.
4. **A one-word or blank name:** the greeting uses the first word; the avatar uses one initial, or "?" if the name is blank. Test in Task 5.
5. **Two overdue instalments on two subscriptions:** "£X outstanding" is their sum, not the first. Test in Task 1.

---

### Task 0: Commit the carried-over work

**Files:** already modified on the branch: `src/features/quote/AddHome.tsx`, `src/features/quote/cover.browser.test.tsx`, `plan/build-plan.md`, `plan/figma.md`, `plan/phases/06-account-claims/phase.md`, `plan/phases/06-account-claims/01-dashboard.md`, `plan/phases/06-account-claims/01-dashboard-plan.md`.

- [ ] **Step 1:** `vp test run src/features/quote/cover.browser.test.tsx`. Expected: 27 passed.
- [ ] **Step 2:** Commit the two code files as `fix(quote): screen 21 says both quotes are ready when the home quote is already done`, and the five plan files as `docs(plan): 6.1 spec and plan, 6.1b split, 6.12/6.13 imports`.

### Task 1: Policy labels and the next payment

**Files:**
- Modify: `src/server/data/policies.ts`
- Modify: `src/features/account/policies.ts` (server functions)
- Test: `src/server/data/policies.int.test.ts`

**Interfaces:**
- Produces:
  - `type PolicyLabel = { kind: "car"; plate: string | null; make: string; model: string } | { kind: "home"; line1: string; town: string } | null`
  - `PolicyListItem` gains `label: PolicyLabel` and `annualPremiumPence: number`
  - `type NextPayment = { kind: "overdue"; outstandingPence: number } | { kind: "due"; amountPence: number; dueOn: string } | { kind: "none" }`
  - `getMyNextPayment: DataRead<{ now?: Date }, NextPayment>` with access `"signed_in"`
  - `getMyNextPaymentFn` (GET server function, `actorMiddleware`)

- [ ] **Step 1: Write the failing tests** in `policies.int.test.ts`:
  - `describe("listMyPolicies: label")`
    - a car policy with `registration: "KR24 BXL"` → `{ kind: "car", plate: "KR24 BXL", make, model }`
    - registration null → `plate: null`
    - a home policy → `{ kind: "home", line1, town }` from its `properties` row
    - another customer's policies are absent
    - a user with no customer row → `[]`
  - `describe("getMyNextPayment")`, with `now = new Date("2026-07-01T23:30:00Z")`, which is 2 Jul 00:30 in London (summer time), so London's today is `2026-07-02`:
    - a `scheduled` payment `dueOn: "2026-07-02"` → `{ kind: "due", amountPence, dueOn: "2026-07-02" }`, not overdue (UTC still says 1 Jul)
    - a `failed` payment `dueOn: "2026-06-15"` plus a `scheduled` one `dueOn: "2026-06-20"` on a second subscription → `{ kind: "overdue", outstandingPence: sum }`
    - only `succeeded` payments → `{ kind: "none" }`
    - another customer's unpaid payment is ignored
    - no customer row → `{ kind: "none" }`
- [ ] **Step 2:** `vp test run src/server/data/policies.int.test.ts`. Expected: FAIL (no `label`, no `getMyNextPayment`).
- [ ] **Step 3: Implement.**
  - `listMyPolicies` reads `annualPremiumPence` and `quoteItemId`, then one query each to `vehicles` and `properties` with `inArray(quoteItemId, ids)`, and maps the label (`null` when there's no detail row).
  - `getMyNextPayment` takes London's date as `YYYY-MM-DD` (`Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" })`).
    - **Unpaid** means status `scheduled` or `failed`.
    - **Overdue** means unpaid with `dueOn` before today; with any overdue → their sum.
    - **Otherwise** → the earliest unpaid `dueOn ≥ today`, else none.
  - Add `getMyNextPaymentFn` next to `listMyPoliciesFn`, and drop that file's "until 6.1" comment.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(account): policies say what they insure, and the next payment is read`.

### Task 2: Indexes and one Actor per request

**Files:**
- Modify: `src/server/db/schema/policies.ts`, `src/server/db/schema/claims.ts`
- Create: `drizzle/0025_*.sql` (with `vp run db:generate`)
- Modify: `src/server/auth/middleware.ts`
- Test: `src/server/auth/actor.int.test.ts`

**Interfaces:**
- Produces: `requestActor(): Promise<Actor | null>` in `middleware.ts`. It's memoised per request in a module `WeakMap<Request, Promise<Actor | null>>` keyed by `getRequest()`. All three middlewares call it instead of `getActor(getRequestHeaders())`.

- [ ] **Step 1: Schema.** Add `index("policies_customer_id_created_at_idx").on(t.customerId, t.createdAt)` and the same on `claims`. Run `vp run db:generate`, and check that the SQL only creates the two indexes (no unique index, so no dedupe needed).
- [ ] **Step 2: Write the failing test** `"builds the actor once per request"`:
  - Mock `getActor`'s Better Auth `getSession`, and run two middleware-wrapped calls inside one request context: one call to `getSession`.
  - `"a deactivated staff member is refused on the next request"`: request A resolves the actor; set `deactivatedAt`; request B → `requirePermission` throws `FORBIDDEN`.
  - Follow the request-context harness already used in `two-factor.int.test.ts`. If none can run two middlewares in one request, test `requestActor` directly with a stubbed `getRequest`.
- [ ] **Step 3:** Run it. Expected: FAIL (two `getSession` calls).
- [ ] **Step 4:** Implement `requestActor`. Never cache across requests (WeakMap key only), and never cache a rejected promise.
- [ ] **Step 5:** Run `vp test run src/server/auth`. Expected: PASS. The integration setup migrates the test database. Don't run `db:migrate`: it targets dev, which is also what staging uses, so the migration reaches dev only when Damion says so (before the preview check).
- [ ] **Step 6:** Commit: `perf(account): policy and claim lists by customer use one index, and the actor is read once per request`.

> **Checkpoint review** (Sonnet): Tasks 1–2, the data and auth layer, before any UI.

### Task 3: `/api/session-hint`

**Files:**
- Create: `src/routes/api/session-hint.ts`, `src/server/auth/session-hint.ts`
- Test: `src/server/auth/session-hint.int.test.ts`

**Interfaces:**
- Produces: `sessionHintResponse(headers: Headers): Promise<Response>`, with body `{ signedIn: boolean }`, `Cache-Control: private, no-store`, `Content-Type: application/json`. The route is a GET handler only, like `api/occupations.ts`.

- [ ] **Step 1: Write the failing tests:** with a session cookie from `signUp`/`sessionCookie` (`src/test/auth.ts`) → `true`; no cookie → `false`; a garbage cookie → `false`; the header is `private, no-store` in all three.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `getAuth().api.getSession({ headers })`, cookie cache allowed. A session still owing a 2FA code counts as signed in (the hint only picks a label).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(auth): an uncached hint tells the public header whether you're signed in`.

### Task 4: "My account" in the public header

**Files:**
- Modify: `src/components/site/SiteHeader.tsx`, `src/components/site/links.ts`, `src/components/site/site.css`
- Create: `src/components/site/use-session-hint.ts`
- Test: `src/components/site/site.browser.test.tsx`

**Interfaces:**
- Produces: `useSessionHint(): "unknown" | "signed-in" | "signed-out"` (fetches `/api/session-hint` once in an effect; a fetch error means `"signed-out"`); `accountMenuLinks: SiteLink[] = [{ label: "Overview", href: "/account" }]`.

- [ ] **Step 1: Write the failing tests** (mock `fetch`):
  - "Log in" shows while the hint is unknown and when signed out
  - when signed in, a "My account" button opens a menu with an "Overview" link to `/account` and a "Log out" button
  - Escape closes the menu
  - the account slot's `offsetWidth` is the same before and after the answer
  - the mobile menu panel lists "Overview" and "Log out" when signed in
- [ ] **Step 2:** Run `vp test run src/components/site/site.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. "Log out" calls `authClient.signOut()`, then `location.assign("/")`. Give the slot a `min-width` equal to the wider of the two labels.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(site): the header says My account when you're signed in`.

### Task 5: The account shell and `/account/settings`

**Files:**
- Create: `src/features/account/AccountShell.tsx`, `src/features/account/AvatarMenu.tsx`, `src/features/account/AccountSettings.tsx`, `src/features/account/account-shell.css`
- Create: `src/routes/account_.settings.tsx`
- Modify: `src/features/auth/AccountPage.tsx` (the `WaysToLogIn`, `TwoFactor` and `CloseAccount` sections move out)
- Test: `src/features/account/account-shell.browser.test.tsx`; update `account.browser.test.tsx`

**Interfaces:**
- Produces:
  - `AccountShell({ name, current, children }: { name: string; current: "overview"; children: ReactNode })`. It renders `DemoStrip`, the skip link, the header from `Acct / Header` (wordmark, an Overview tab with `aria-current="page"`, `AvatarMenu`), `ClosureBanner`, then `<main id="main">`.
  - `initialsOf(name: string): string`: the first letters of the first and last words, upper case; one word → one letter; blank → "?".
  - `AccountSettings({ summary }: { summary: AccountSummary })`: the three sections as they are today.
  - The route `/account/settings`: the same guard as `/account` (`requireSignedIn`, `getAccountSummary`), `private, no-store`, the same `?confirmed|linked|error` search and `useOneTimeToast`.
  - Google linking's `callbackURL` becomes `/account/settings?linked=google`, and its `errorCallbackURL` becomes `/account/settings?error=link`.

- [ ] **Step 1: Write the failing tests:**
  - `initialsOf("Maya Patel") === "MP"`, `initialsOf("Cher") === "C"`, `initialsOf("  ") === "?"`
  - the shell shows the Overview tab as current, with no Policies, Claims or Documents tab and no bell
  - the avatar menu opens and lists "Account settings" (`/account/settings`) and "Log out"; Escape closes it and focus returns to the avatar
  - Settings renders "Ways to log in", "Two-factor" and "Close your account", and Connect Google uses the new callback URLs
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Match the header's colours, height and avatar to frames 01 and 04 (read `181:3310` with `get_design_context`), using existing tokens only.
- [ ] **Step 4:** Run the new test and `account.browser.test.tsx` (its moved-section assertions now target `AccountSettings`). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(account): the account header, and settings move to their own page`.

### Task 6: The Overview

**Files:**
- Create: `src/features/account/Overview.tsx`, `src/features/account/overview.ts` (pure helpers), `src/features/account/overview.css`
- Modify: `src/routes/account.tsx`. Its loader adds `getMyNextPaymentFn()`, and the page renders `<AccountShell><Overview/></AccountShell>`.
- Delete: `src/features/auth/AccountPage.tsx` (all of it now lives in the account feature files), and `greetingFor` plus its `greeting` field in `session.ts` if nothing else uses them.
- Test: `src/features/account/overview.test.ts`, `src/features/account/overview.browser.test.tsx`; update `billing-link.browser.test.tsx`

**Interfaces:**
- Consumes: `PolicyListItem` (with `label`, `annualPremiumPence`), `NextPayment` (Task 1), `AccountShell` (Task 5).
- Produces:
  - `isHeld(p: PolicyListItem, today: string): boolean`
  - `isCovered(p, today): boolean` (active and not ended)
  - `greetingLine(now: Date): string` ("Tuesday 18 November")
  - `overviewStats(policies, today): { held: number; yearPence: number; bundleSavingPence: number }`. The saving counts each held bundle once.
  - `rowStatus(p, today): { tone: "success" | "warning" | "neutral"; label: string; date: string | null }`, giving "Active" / "Starts 3 Dec" / "Lapsed" / "Cancelled" / "Ended", with "Renews 14 Mar 2027" / "Ended …" / null for lapsed.

- [ ] **Step 1: Write the failing unit tests** (`overview.test.ts`), with `today = "2026-11-18"`:
  - lapsed is held and not covered
  - cancelled and ended aren't held
  - `startsOn` after today → "Starts 1 Dec"
  - the year sum and saving for a bundle of two held policies, and a bundle with one cancelled half
  - `greetingLine(new Date("2026-11-18T09:00:00Z")) === "Tuesday 18 November"`
- [ ] **Step 2: Write the failing component tests** (`overview.browser.test.tsx`):
  - frame 01 data: "Hi Maya, you're covered.", three stat cards, "£44.70" / "on 1 Dec" / "Manage payments", "after your £96.00 bundle saving", the bundle group with "You save £96.00 a year", the plate "KR24 BXL", "Volkswagen Golf", "Active", "Renews 14 Mar 2027", the home row "11 Rosebery Gardens, London"
  - frame 02 data: "Hi Maya", "Payment due" and "£44.70 outstanding", the "Lapsed" badge, the lapsed message, no renews date
  - frame 03 data: no stat cards, "You don't have any policies yet.", "Get a quote" → `/quote`, "Your saved quotes" → `/quote/retrieve`
  - an annual payer: "All paid for this year" and no "Manage payments"
  - a car with no plate: no plate element
  - no "Open claims", no add-product card
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Stat cards use the Policy overview card style. With three cards, use `repeat(3, 1fr)`.
  - "Manage payments" is a `<Link to="/account/billing" reloadDocument>`, shown when any policy is `monthly`.
  - Money: `formatPounds`.
  - Bundles keep using `groupByBundle`, moved into `overview.ts`.
  - Rows show only what has data, in the frame 01 layout. Read `258:3608` with `get_design_context` for spacing and type.
- [ ] **Step 5:** Repoint `billing-link.browser.test.tsx` at `Overview`'s "Manage payments" (the same never-on-preload assertions).
- [ ] **Step 6:** Run `vp test run src/features/account src/features/auth`. Expected: PASS.
- [ ] **Step 7:** Commit: `feat(account): the overview: greeting, your next payment, what you pay a year, and your policies by car and address`.

### Task 7: End-to-end, axe and done-markers

**Files:**
- Modify: `e2e/buy.spec.ts`, `e2e/home-buy.spec.ts`, `e2e/a11y.spec.ts`
- Modify: `plan/phases/06-account-claims/01-dashboard.md`, `plan/phases/06-account-claims/phase.md`, `plan/build-plan.md`

- [ ] **Step 1: Update the E2E.**
  - `buy.spec.ts` step 8 becomes: `/account` shows the car's make and model, "Active" and "Next payment"; then `page.goto("/")` shows a "My account" button (the hint), and `expectCdnCached` still passes for `/`.
  - `home-buy.spec.ts`: the home row shows the address line.
  - `a11y.spec.ts` adds `/account/settings` to the signed-out redirect list. Axe runs on `/account` and `/account/settings` in `buy.spec.ts` after sign-in.
- [ ] **Step 2:** Run `vp check`, `vp test`, then the E2E locally against the local stack (stop `vp dev` first). Expected: all pass.
- [ ] **Step 3: Done-markers.** Set the spec's Status to `done (#PR)`, mark the phase row `done`, tick the `build-plan.md` box, and add "Notes from the build" for anything that differed from the spec.
- [ ] **Step 4:** Commit: `test(account): the buy journeys check the overview and My account; 6.1 marked done`.

> **Final review** (Sonnet), on the whole branch, before the PR. Then push, open the PR into `staging` using `.github/pull_request_template.md` (Slice, Done when, Preview, Checks, and the co-author line), with the title from the spec's commit message.
