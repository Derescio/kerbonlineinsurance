# 6.3b Policy changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A car policyholder changes their address, adds or removes a driver, or changes cover and voluntary excess from the policy page. Each change is re-priced on the policy's own rating version, shown before Confirm, settled in Stripe, and recorded as a numbered `policy_versions` snapshot.

**Architecture:**
- **Pure money rules** live in `src/features/policy-changes/money.ts`.
- **The server core** lives in `src/server/policy-changes/`:
  - `inputs.ts`: `CarInputs` from stored rows.
  - `snapshot.ts`: the version snapshot.
  - `price.ts`: the before and after re-price.
  - `apply.ts`: `changePolicy`, which writes rows, the version and the audit row.
  - `settle.ts`: Stripe.
  - `writes.ts`: the `defineRead` and `defineWrite` entry points.
- **Webhooks:** the annual top-up rides the existing webhook. `checkout.session.completed` and `checkout.session.expired` branch on `metadata.policy_change_id` before the quote path.
- **The page:** `getMyPolicy` and the schedule read money from the latest snapshot. Details still come from the bought quote item's rows, which changes update in place.

**Tech Stack:** TanStack Start (server functions), Drizzle + Postgres (drizzle-kit migrations), Stripe (`src/test/stripe-fake.ts` in tests), Vitest (`vp test`: unit, integration, browser), Playwright.

**Spec:** [03b-policy-changes.md](03b-policy-changes.md). Figma Account · Policy `183:3502`: dialogs 03 Add a driver `183:3955`, 04 Change address `183:4072`, 05 Change cover `183:4168`.

## Global Constraints

**Branch and commits:**
- Branch `slice/6.3b-policy-changes`, made from `staging`.
- Stage files by name, never a folder.
- Task 0 is the one commit that includes Damion's `plan/phases/07-kerbie/phase.md` and `plan/phases/09-data/phase.md`, which he asked to go with this slice's first docs push. After Task 0, they're never staged again by accident: check `git status` before every commit.
- Every commit ends with both lines:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

**Local running:**
- Don't run browser tests or `vp build` while `vp dev` is running.
- The migration is never run against `dev`/staging from this branch. Previews don't migrate, so local integration and E2E only (`vp run db:test:up`).

**Money:**
- Whole pence.
- `diffPence = after.totalPence − before.totalPence`: a car-only `quoteTotals` line, fee included on both sides so it cancels.
- `newAnnual = annual_premium_pence + (after.premium − after.discount + after.addons) − (before.premium − before.discount + before.addons)`, floored at 1.
- Pro-rata: `days left = ends_on − today` and `term days = ends_on − starts_on`, both London dates.
- **Annual:** `due = Math.round(diffPence × daysLeft ÷ termDays)`.
- **Monthly:** each remaining instalment changes by `Math.floor(diffPence × daysLeft ÷ termDays × (1 + creditRate) ÷ instalmentsLeft)`, the same for every one. A negative difference goes the other way by the same rule, with `Math.ceil` toward zero so Kerb absorbs the pennies.
- Saving rate in both prices: the version's `bundle_discount_rate` when `quotes.bundle_discount_pence > 0`, else 0. It's passed as `quoteTotals(lines, rate)`.

**Re-pricing:**
- Always on the policy's `quote_items.rating_version_id`, never the active version.
- Either price `referred` or `declined` means nothing applies.

**Copy, verbatim:**
- "Make a change", "Add a driver", "Change address", "Change cover", "Remove", "Remove driver", "Confirm change", "Back".
- "The change applies from today. There's no admin fee."
- "We can't make this change online."
- "We can't add a driver with recent claims or convictions online."
- "They've had no claims or convictions in the last 5 years"
- "Not available online"
- "The price has changed"
- "Your policy's been updated"
- "Your policy changed while you were paying, so we've refunded you. Please try again."
- Price lines:
  - "Your price goes up by £X a month"
  - "Your price goes down by £X a month"
  - "Your price stays the same"
  - "You'll pay £X now for the rest of the year"
  - "We'll refund £X to your card"
- "Your home insurance isn't changed. It still covers {addressLine1}."
- "Remove {first} {last} from your policy?"

**Audit** (no names and no full addresses):
- `policy.address_changed` `{ postcode_area, overnight_location }` from/to
- `policy.driver_added` `{ relationship, licence_years }`
- `policy.driver_removed` `{ relationship }`
- `policy.cover_changed` `{ cover_level, addons: { added, removed }, voluntary_excess_pence }`

**Out of 6.3b:**
- Change car and home changes (6.3c)
- Cancel (6.3d)
- Renewal (6.3e)
- Moving house
- Future-dated changes
- Staff handling of referred changes (6.11)

## Review Focus

1. **A policy bought before this slice.** Its version-1 row comes from the migration backfill, and its page shows exactly the same money as before. Test in Task 1 (backfill) and Task 3 (page unchanged).
2. **The top-up's `checkout.session.completed` delivered twice, or after the session expired locally.** It applies once. A second delivery is a no-op, and a completed payment for an `abandoned` change is refunded. Test in Task 5.
3. **Several decreases on an annual policy.** Each refund is capped at what that payment intent has left, the original first and then the latest top-up's. It's never refused for "exceeds charge". Test in Task 5.
4. **A Confirm sent from a stale dialog** (another tab applied a change since it was priced). It's refused with the new price line, not applied over the newer version. Test in Task 4.
5. **The last days of a policy.** The final instalment is already taken (the change is applied, with no Stripe call), and `ends_on` today (refused: "Make a change" isn't shown). Test in Task 2 (money) and Task 4 (eligibility).

---

### Task 0: Commit and push the docs, with Damion's edits

**Files:**
- `plan/phases/06-account-claims/03b-policy-changes.md`
- `plan/phases/06-account-claims/03b-policy-changes-plan.md`
- `plan/phases/06-account-claims/phase.md`
- `plan/build-plan.md`
- `plan/phases/07-kerbie/phase.md` (Damion's)
- `plan/phases/09-data/phase.md` (Damion's)

- [ ] **Step 1:** `git add` the six files by name. Commit `docs(account): 6.3b policy changes spec and plan; 6.3c–6.3e added; Kerbie and data phase notes` with the two trailers.
- [ ] **Step 2:** `git push -u origin slice/6.3b-policy-changes`. Expected: the branch is created on origin and no PR is opened yet.

---

### Task 1: Tables, migration, backfill and data contract

**Files:**
- Modify: `src/server/db/schema/policies.ts` (add `policyChanges`, `policyVersions`), `src/server/db/schema/values.ts`, `src/server/db/schema/relations.ts`, `src/server/db/data-contract.ts`, `src/server/account/delete.ts`
- Create: `drizzle/0027_policy_changes.sql` (generated, then hand-edited), `src/server/policy-changes/snapshot.ts`
- Test: `src/server/db/constraints.int.test.ts` (extend), `src/server/policy-changes/backfill.int.test.ts`, `src/server/account/account.int.test.ts` (extend)

**Interfaces:**
- Produces in `values.ts`:
  - `policyChangeKinds = ["address", "driver_added", "driver_removed", "cover"]`
  - `policyChangeStatuses = ["priced", "awaiting_payment", "applied", "failed", "abandoned", "refused"]`
  - `policyChangeSettlements = ["charge", "refund", "instalments", "none"]`
- Produces `policy_changes` (spec decision 8):
  - `customerId` and the composite FK `(policyId, customerId) → policies (id, customer_id)`.
  - `request jsonb` (contract: `drop`, since it can hold a driver's name). Everything else is `keep`.
  - Partial unique index `policy_changes_one_open_per_policy` on `(policy_id) where status = 'awaiting_payment'`.
  - Unique on each Stripe id.
- Produces `policy_versions` with columns `policyId`, `version`, `effectiveFrom`, `policyChangeId` (nullable FK), `snapshot jsonb` and `personal jsonb`:
  - Unique `(policy_id, version)`.
  - Append-only: contract `changeColumn: "created_at"`, `kind: "append-only"`. `snapshot` is `keep`; `personal` (names, dates of birth, address lines) is `drop`. *(plan call: a jsonb column can't be hashed per key, so the personal parts are split out.)*
- Produces in `snapshot.ts`:
  - `type PolicySnapshot = { snapshotVersion: 1; coverLevel; compulsoryExcessPence; voluntaryExcessPence; annualPremiumPence; money: { tierPence; addons: { addon; annualPricePence }[]; savingPence; quoteTotalPence; instalmentPence: number | null }; drivers: { isMain; relationship; licenceYears; ageBand }[]; overnightLocation: string | null; postcodeDistrict }`
  - `type PolicyPersonal = { drivers: { firstName; lastName; dateOfBirth }[]; address: { line1; line2; town; postcode } }`
  - `readSnapshot(db: Db | Tx, policyId: string): Promise<{ snapshot: PolicySnapshot; personal: PolicyPersonal }>` reads today's rows, with money computed as `getMyPolicy` computes it today.
  - `writeVersion(tx, policyId, version, policyChangeId: string | null, now: Date): Promise<void>` calls `readSnapshot` and inserts.

- [ ] **Step 1: Write the failing tests.**
  - `constraints.int.test.ts`:
    - "refuses a second awaiting_payment change for one policy"
    - "refuses a duplicate policy version"
    - "policy_changes and policy_versions have the record_delete trigger" (the existing every-copied-table check now covers them)
  - `backfill.int.test.ts`: "backfills version 1 for every policy, with the money getMyPolicy shows". Buy a monthly bundle and an annual car with `src/test/purchase.ts`, delete their version rows, run the backfill SQL from the migration, and assert one row each with `version = 1`, `policy_change_id null`, and `money.quoteTotalPence` equal to the quote's `total_pence`.
  - `account.int.test.ts`: "deleting an account removes its policy changes and versions".
- [ ] **Step 2:** Run `vp test src/server/db/constraints.int.test.ts src/server/policy-changes src/server/account/account.int.test.ts`. Expected: FAIL (no tables).
- [ ] **Step 3:** Add the tables and the contract entries, then run `vp run db:generate`. Rename the output to `0027_policy_changes.sql` and update `meta/_journal.json`. Hand-edit the migration in the 0021 style:
  - A header comment.
  - `set_updated_at()` and `record_delete('id')` triggers on `policy_changes`; `record_delete('id')` on `policy_versions`.
  - The version-1 backfill as one `INSERT … SELECT … WHERE NOT EXISTS` (so a preview or E2E row can't collide), building the same JSON as `readSnapshot`.

  Then make `delete.ts` remove both tables' rows before `policies`.
- [ ] **Step 4:** Run the same tests and `vp run db:check`. Expected: PASS and no drift.
- [ ] **Step 5:** Commit `feat(policy-changes): policy_changes and policy_versions tables, version 1 for every policy`.

---

### Task 2: Money rules and inputs from a stored policy

**Files:**
- Create: `src/features/policy-changes/money.ts`, `src/server/policy-changes/inputs.ts`
- Test: `src/features/policy-changes/money.test.ts`, `src/server/policy-changes/inputs.int.test.ts`

**Interfaces:**
- Produces in `money.ts`:
  - `daysBetween(from: string, to: string): number`
  - `annualSettlement(diffPence: number, today: string, startsOn: string, endsOn: string): { kind: "charge" | "refund" | "none"; pence: number }`
  - `instalmentChange(diffPence: number, today: string, startsOn: string, endsOn: string, creditRate: number, instalmentsLeft: number): number` (0 when `instalmentsLeft` is 0)
  - `priceLine(plan: "annual" | "monthly", pence: number, direction: "up" | "down" | "same"): string` (the Global Constraints copy, `formatPounds`)
- Produces in `inputs.ts`:
  - `type PolicyChangeRequest = { kind: "address"; postcode: string; addressLine1: string; addressLine2: string | null; town: string; overnightLocation: OvernightLocation } | { kind: "driver_added"; driver: { firstName; lastName; dateOfBirth; relationship; licenceType; licenceDate; occupation; employmentStatus; noClaimsConfirmed: true } } | { kind: "driver_removed"; driverId: string } | { kind: "cover"; coverLevel: CoverLevel; addons: string[]; voluntaryExcessPence: number }`
  - `loadPolicyForChange(tx: Tx, policyId: string): Promise<StoredPolicy>`: locks `policies` `for update` and reads the item, vehicle, drivers, prior claims, customer, quote, selected add-ons and rating version id
  - `carInputsFromPolicy(stored: StoredPolicy, today: string, change?: PolicyChangeRequest): { inputs: CarInputs; coverLevel: CoverLevel; addons: string[] }`. Ages come from `date_of_birth` today. Licence years are as stored, except a new driver's, from `licenceDate`. `pastClaims` is the stored drivers' sum. `postcodeArea` comes from the customer's postcode, or the request's for an address change.

- [ ] **Step 1: Write the failing tests.**
  - `money.test.ts`:
    - "annual: £120 more with 73 of 365 days left charges £24.00"
    - "annual: a decrease is a refund"
    - "monthly: £120 more, 73/365 days, credit rate 0.1, 2 instalments left adds £13.20 to each"
    - "monthly: rounding is the same on every instalment and never more than the difference"
    - "monthly: no instalments left changes nothing"
    - "a leap-year term counts 366 days"
    - "zero difference is none"
    - "price lines read as the spec words them" (all five)
  - `inputs.int.test.ts`:
    - "a bought policy's inputs match the ones it was priced from, ages aside": buy a car policy, then compare to the item's stored `inputs`
    - "an added driver joins namedDrivers with licence years from the licence date"
    - "a removed driver leaves"
    - "an address change takes the new postcode area"
    - "a cover change carries the level, add-ons and voluntary excess"
- [ ] **Step 2:** Run `vp test src/features/policy-changes src/server/policy-changes/inputs.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `daysBetween` uses UTC dates parsed from ISO strings, matching `wholeYearsBetween`'s style.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): pro-rata money rules and inputs from a stored policy`.

---

### Task 3: Version 1 at purchase, money from the latest version

**Files:**
- Modify: `src/server/quote/purchase.ts` (after `insertPolicy` and the payments, call `writeVersion(tx, policy.id, 1, null, now)` for each policy), `src/server/data/policies.ts` (`getMyPolicy`'s `coverPremiumPence`, `addons` prices, `saving`, `plan.instalmentPence` and `quote.totalPence` come from the latest `policy_versions.snapshot.money`), `src/server/documents/` (the schedule's money, the same way)
- Test: `src/server/quote/purchase.int.test.ts` (extend), `src/server/data/policies.int.test.ts` (extend or create)

**Interfaces:**
- Consumes: `writeVersion`, `PolicySnapshot` (Task 1).
- Produces: `latestVersion(db: Db | Tx, policyId: string): Promise<{ version: number; snapshot: PolicySnapshot }>` in `snapshot.ts`.

- [ ] **Step 1: Write the failing tests.**
  - "purchase writes version 1 for each policy in a bundle"
  - "getMyPolicy shows the latest version's money": insert a version 2 whose `money.tierPence` differs and assert the page value follows it, while drivers still come from the rows
  - "an unchanged policy's page money is what it was before 6.3b": compare against the 6.2 fixture values
- [ ] **Step 2:** Run `vp test src/server/quote/purchase.int.test.ts src/server/data`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `getMyPolicy`'s return type unchanged, so `PolicyDetailPage` doesn't change in this task.
- [ ] **Step 4:** Run those tests plus `vp test src/features/account` (the 6.2 component tests). Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): a version at purchase, and the policy page's money from the latest version`.
- [ ] **Step 6: Checkpoint review.** Dispatch one reviewer (`model: sonnet`) on Tasks 1–3, which touch the shipped purchase path, the policy page and the data contract. Fix what it finds before Task 4.

---

### Task 4: Pricing a change and applying it

**Files:**
- Create: `src/server/policy-changes/price.ts`, `src/server/policy-changes/apply.ts`, `src/server/policy-changes/writes.ts`
- Modify: `src/server/audit/actions.ts` (the four actions, entity `policy`), `src/server/data/permissions.int.test.ts` (register the three functions)
- Test: `src/server/policy-changes/change.int.test.ts`

**Interfaces:**
- Consumes: `loadPolicyForChange`, `carInputsFromPolicy`, `annualSettlement`, `instalmentChange`, `writeVersion`.
- Produces in `price.ts`:
  - `priceChange(tx, stored, change, today): Promise<PricedChange>`, where `PricedChange = { outcome: "quoted" | "referred" | "declined"; reasonCode: ReasonCode | null; priceBeforePence; priceAfterPence; oldAnnualPence; newAnnualPence; diffPence; settlement: "charge" | "refund" | "instalments" | "none"; amountPence: number; priceLine: string }`
  - It runs `priceQuote` twice on `getRatingTables(tx, stored.ratingVersionId)`, totals each with `quoteTotals([carLine], savingRate)`, and works out the settlement with Task 2's rules (monthly: count the `scheduled` payments rows).
- Produces in `apply.ts`:
  - `changePolicy(tx: Tx, input: { policyId: string; change: PolicyChangeRequest; priced: PricedChange; actor: Actor | null; changeId: string; now: Date }): Promise<{ version: number }>`. Kerbie 7.5 calls this.
  - It updates the rows (spec decision 2) and `policies.annual_premium_pence`, `cover_level`, `compulsory_excess_pence` and `voluntary_excess_pence`, bumps `policies.version`, calls `writeVersion`, writes the audit row, and marks the change `applied` with `to_version`.
  - For an address change on a bundle, it leaves `quotes.postcode` alone (spec decision 11).
- Produces in `writes.ts`:
  - `priceMyPolicyChange` (`signed_in`, defineWrite, `limit: { action: "policy.change_price", rule: { max: 30, windowSeconds: 3600 } }`, keyed per policy). Input: `{ reference, change }`. It checks eligibility (spec decision 6 and the second-car rule in 11), inserts a `priced` row (or `refused` for referred/declined), and returns `{ status: "priced"; changeId; priceLine; settlement; amountPence; homeWarning: string | null } | { status: "refused"; message }`.
  - `confirmMyPolicyChange` (defineWrite, `idempotent: { action: "policy.change_confirm" }`). Input: `{ changeId }`. It locks the policy and re-prices. A different price or a moved version is rejected with "The price has changed" and the new line. Otherwise it settles (Task 5 hooks in here; in this task `none` and `instalments` apply directly) and returns `{ status: "applied" } | { status: "pay"; clientSecret: string } | { status: "refused"; message }`.
  - `abandonMyPolicyChange` (defineWrite). Input: `{ changeId }`. It marks a `priced` or `awaiting_payment` change `abandoned` and expires its session.

- [ ] **Step 1: Write the failing tests** in `change.int.test.ts`:
  - "adding a driver updates the rows, writes version 2, bumps version and audits without the name"
  - "removing a driver deletes the row; version 2's personal still has them"
  - "an address change updates the customer, quotes.postcode and overnight location; a bundled car leaves quotes.postcode"
  - "a cover change updates the level, add-ons, excesses and premium"
  - "re-prices on the bought rating version, not the active one": buy on v1, activate a v2 with different rates, add a driver, and assert the diff equals the v1 diff
  - "a driver's birthday since purchase doesn't move the price": `now` set a year on and a no-op cover change gives diff 0
  - "a referred after-price changes nothing and records a refused change"
  - "a policy that now refers as it stands is refused"
  - "refused for another customer's (NOT_FOUND), a home, a lapsed, a cancelled, an ended policy, and one with a failed instalment"
  - "an address change is refused when the customer holds another active car policy"
  - "homeWarning names the home policy's address"
  - "a stale confirm is refused with the new price line"
  - "the same idempotency key confirms once"
  - "the unticked claims box is refused by the schema"
- [ ] **Step 2:** Run `vp test src/server/policy-changes/change.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Validate the driver with the journey's `namedDriver` rules (export it from `driver-steps.ts`) and `noClaimsConfirmed: z.literal(true)`. Validate the excess with `VOLUNTARY_EXCESS_PENCE` and the address with `normalisePostcode`.
- [ ] **Step 4:** Run the test, `vp test src/server/data/permissions.int.test.ts`, and `vp test src/server/audit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): price and apply a change with its version and audit`.

---

### Task 5: Settling in Stripe

**Files:**
- Create: `src/server/policy-changes/settle.ts`
- Modify: `src/server/payments/webhook-handlers.ts` (`checkoutCompleted` and `checkoutExpired` branch on `metadata.policy_change_id` first), `src/server/policy-changes/writes.ts` (Confirm calls `settle`)
- Test: `src/server/policy-changes/settle.int.test.ts`

**Interfaces:**
- Produces in `settle.ts`:
  - `startTopUp(tx, change, stored, stripe, now): Promise<{ clientSecret: string }>`:
    - Creates an embedded session (`ui_mode: "embedded_page"`, `mode: "payment"`, cards only, `customer` = `customers.stripe_customer_id`).
    - One `price_data` line, "Change to {reference}: {kind label}", where the kind labels are "new address", "added driver", "removed driver" and "cover change".
    - `metadata` and `payment_intent_data.metadata` carry `{ kerb_env, policy_change_id }`, with a 30-minute expiry.
    - `return_url` is `/account/policies/{reference}?change={id}`.
    - Sets the change to `awaiting_payment` with `stripe_session_id`.
  - `completeTopUp(sessionId: string, deps: HandlerDeps): Promise<void>`. It runs in its own transaction and locks the change:
    - `applied` already: return.
    - The session isn't paid: return.
    - The change is `abandoned` or `failed`, or the policy version has moved: refund the session's payment intent in full and mark it `failed` with `failure_reason` `"version_moved"` or `"abandoned"`.
    - Otherwise: `changePolicy` and store `stripe_payment_intent_id`.
  - `refundDecrease(tx, change, stored, stripe, now): Promise<void>`. Refunds from the original `payments.stripe_payment_intent_id` up to `amount − amount_refunded` (from `paymentIntents.retrieve`), then from the newest applied top-up's payment intent. Each call is `refunds.create` with idempotency key `policy-change-refund:{changeId}:{paymentIntentId}`.
  - `updateInstalments(tx, change, stored, stripe, deltaPence): Promise<void>`:
    - Sets the `scheduled` rows' `amount_pence` to `old + delta`.
    - Retrieves the subscription, then calls `subscriptions.update(id, { items: [{ id: item.id, price_data: { currency: "gbp", product: item.price.product, unit_amount: newAmount, recurring: { interval: "month" } } }], proration_behavior: "none" })`. Subscription items take `product`, not `product_data`.
    - A bundle updates the one shared subscription.

- [ ] **Step 1: Write the failing tests** in `settle.int.test.ts`, with the Stripe fake:
  - "annual increase: Confirm returns pay, the session carries policy_change_id, nothing applied yet"
  - "checkout.session.completed applies it once, delivered twice"
  - "a policy changed while paying: the top-up is refunded in full and the change failed"
  - "a payment for an abandoned change is refunded"
  - "checkout.session.expired marks the change abandoned"
  - "annual decrease: refunded on the original payment intent at Confirm"
  - "a refund larger than the original has left spills onto the latest top-up"
  - "monthly increase: scheduled rows and the subscription item change, proration none; the next invoice.paid still matches its row"
  - "monthly with no instalments left: applied, no Stripe call"
  - "bundle: the shared subscription changes and the home policy's premium doesn't"
  - "the quote checkout path is untouched by a session without policy_change_id": the existing `webhook.int.test.ts` still passes
- [ ] **Step 2:** Run `vp test src/server/policy-changes/settle.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `paymentIntents.retrieve` returning `amount_refunded` to the fake if it's missing.
- [ ] **Step 4:** Run `vp test src/server/policy-changes src/server/payments`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): settle the difference in Stripe: top-up, refund, or new instalments`.
- [ ] **Step 6: Checkpoint review.** Dispatch one reviewer (`model: sonnet`) on Tasks 4–5: the money, the webhook branch and the races. Fix what it finds before Task 6.

---

### Task 6: Server functions and the email

**Files:**
- Create: `src/features/policy-changes/server.ts`
- Modify: `src/server/email/registry.ts` and `templates.ts` (`policy_changed`), `src/server/policy-changes/apply.ts` (queue the email after apply)
- Test: `src/server/email/registry.test.ts` (extend), `src/server/policy-changes/change.int.test.ts` (one case)

**Interfaces:**
- Produces: `priceMyPolicyChangeFn`, `confirmMyPolicyChangeFn` and `abandonMyPolicyChangeFn` (POST, `actorMiddleware`, `getRequestHeaders()`, each importing `#/server/policy-changes/writes` in the handler, as `settings.ts` does).
- Produces the template `policy_changed` with params `{ firstName, reference, summary, priceLine, policyUrl }`. Subject: "Your Kerb policy {reference} has changed".

- [ ] **Step 1:** Write the failing tests: "policy_changed renders with every param" and "an applied change queues one policy_changed email".
- [ ] **Step 2:** Run `vp test src/server/email src/server/policy-changes/change.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Queue with `queueEmail(tx, …)` inside `changePolicy`'s transaction. The callers run `runSoon` after commit, as the webhook does.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): server functions and the policy changed email`.

---

### Task 7: Make a change on the policy page

**Files:**
- Create: `src/features/policy-changes/MakeAChange.tsx`, `ChangeAddressDialog.tsx`, `AddDriverDialog.tsx`, `RemoveDriverDialog.tsx`, `ChangeCoverDialog.tsx`, `PriceLine.tsx`, `TopUpCheckout.tsx`, `policy-changes.css`
- Modify: `src/features/account/PolicyDetailPage.tsx` (show the section and the Drivers card's "+ Add" and "Remove" for an eligible car policy), `src/features/account/policy-detail.browser.test.tsx` (the "no action that leads nowhere" test now expects them on an eligible car policy and still not on home, lapsed or ended ones), `src/server/data/policies.ts` (`PolicyDetail` gains `changes: { eligible: boolean; driverIds: string[]; namedDriverCount: number; openChangeId: string | null }`)
- Test: `src/features/policy-changes/policy-changes.browser.test.tsx`

**Interfaces:**
- Consumes: Task 6's server functions, `PolicyDetail.changes`.
- Dialogs use `src/components/feedback/Dialog.tsx`, `Alert`, `forms/*` and `insurance/CoverageOption`.
- Address uses `checkPostcode` and `findAddresses` from `#/features/quote/server`. Cover uses `VOLUNTARY_EXCESS_PENCE`. Relationship, licence and employment options come from `driver-steps.ts`.
- Pricing runs when the form becomes valid (debounced 300 ms). Confirm sends one idempotency key per press.
- `TopUpCheckout` mounts Stripe's embedded checkout as the quote's pay step does. On return (`?change=`) the page reloads and shows the toast, or the refunded message for a failed change.

- [ ] **Step 1: Write the failing tests** in `policy-changes.browser.test.tsx`:
  - "shows Make a change with three cards on an eligible car policy, none on home"
  - "Add a driver: the price line appears once the form is valid; unticked box shows the claims message and no Confirm"
  - "Remove: no Remove on the main driver; the dialog names the driver"
  - "Change cover: three levels, the current one selected, a referred level 'Not available online', the excess select"
  - "Change address: the home warning when the customer has home insurance"
  - "a refused price shows 'We can't make this change online.' with no Confirm"
  - "Confirm on an annual increase mounts the checkout; on applied, the toast"
  - "'The price has changed' replaces the line on a stale confirm"
- [ ] **Step 2:** Run `vp test src/features/policy-changes src/features/account` (`vp dev` stopped). Expected: FAIL.
- [ ] **Step 3:** Implement to the frames. The note under each price line is "The change applies from today. There's no admin fee." At 390px the dialogs go full width, as `Dialog` already does.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): Make a change dialogs on the policy page`.

---

### Task 8: E2E and axe

**Files:**
- Create: `e2e/policy-changes.spec.ts` (next to the existing account specs)

- [ ] **Step 1:** Write two tests:
  - "monthly: add a driver, see the price go up, confirm; Drivers and Per month update"
  - "annual: change cover up, pay the top-up with 4242 4242 4242 4242, the policy shows the new cover"

  Add axe checks on each dialog at 390, 768 and 1440px.
- [ ] **Step 2:** Run `vp run db:test:up`, then the Playwright command the account specs use, with `vp dev` on port 3000 and Turnstile test keys (6.3's notes). Expected: PASS.
- [ ] **Step 3:** Commit `test(policy-changes): E2E for a monthly and an annual change, axe on the dialogs`.

---

### Task 9: Done markers and the PR

- [ ] **Step 1:** Run `vp check`, `vp test` and `vp build` (`vp dev` stopped). Expected: all pass.
- [ ] **Step 2:** Final whole-branch review (`model: sonnet`). Fix the findings, and record what was kept or parked under the spec's "Notes from the build".
- [ ] **Step 3:** Done markers per `plan/git-workflow.md`:
  - the spec's Status
  - the 6.3b row in `phase.md`
  - the box in `build-plan.md`
- [ ] **Step 4:** Commit `docs(account): 6.3b done markers and build notes`, push, and open the PR into `staging`:
  - Title: the spec's commit message.
  - Body: the template sections, the "Done when" list, the preview URL, and both trailers in the body.
  - Damion runs the preview check, including one annual top-up with a test card.
