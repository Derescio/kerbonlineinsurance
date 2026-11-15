# 5.6 Pay, policy saved, retrieve a quote: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A priced car quote becomes a policy. A guest signs in or creates an account at Buy without losing the quote. The quote is saved, paid for with a demo card in one idempotent transaction, and shown on You're covered, `/account` and Your saved quotes.

**Architecture:** There are four layers.
1. **Pure helpers** in `src/features/quote/`: the card checks, the policy dates, the payment schedule and the saved-quote key.
2. **Server writes** in `src/server/quote/`:
   - `saveCarQuoteFor()` re-prices the journey and saves it with the customer row. It's called by the `saveCarQuote` write and by Better Auth's user-create hook.
   - `payForQuote` is one `defineWrite` transaction.
3. **Owner-only reads** in `src/server/data/quotes.ts`.
4. **The UI:**
   - `step=buy` on `/quote/car`;
   - three new routes: `/quote/pay/$quoteId`, `/quote/covered/$quoteId` and `/quote/retrieve`;
   - a "Your policies" section on `/account`.

**Tech Stack:** TanStack Start / Router file routes, React 19, React Query, Zod 4, Drizzle on Neon Postgres, Better Auth, Vitest (`unit`, `int`, `component`), Playwright with axe.

**Spec:** [06-pay-and-retrieve.md](06-pay-and-retrieve.md). Read all 14 decisions first. Figma: screens 14 (`226:714`), 15 (`226:729`), 17 (`226:759`), 18 (`226:774`), and the Purchase frame (`157:11256`).

## Global Constraints

- **The browser's prices are never trusted.** Save re-prices on the server, and pay reads the saved rows.
- **Card details:**
  - The card number and security code are never stored, logged, audited or put in an idempotency payload.
  - `payForQuote` strips them from its parsed input before `defineWrite` hashes the payload. Pass only `{ brand, last4 }` on, and hash the card number separately if a replay check needs it.
  - The idempotency payload is checked in Task 5's test.
- **References:**
  - A policy is `KRB-` + six digits drawn from 100000–899999. A quote is `KRB-Q-` + five digits, as now.
  - Both are retried on `23505`, the way `saveQuote()` does.
- **Rate rules:** `quote.save` is `{ max: 20, windowSeconds: 3600 }` and `quote.pay` is `{ max: 10, windowSeconds: 3600 }`. They go in a new `src/server/data/rate-limit-rules.ts`, as 4.5c names it.
- **Staff can't buy** *(a gap in the spec, settled here)*. A staff actor or user gets the write rejected with `Staff accounts can't buy policies.`, and no customer row is made (4.2: staff have no customer row).
- **Dates:**
  - Cover starts from today (London) up to today + 30 days; the default is tomorrow.
  - It ends a year later, less a day.
  - Monthly instalment *n* is due on the start date + (*n* − 1) months, with the day clamped to the month's end.
- **Copy, exactly:**
  - **Gate:**
    - Headings: `Sign in before you pay` and `Create your account to continue`.
    - Card headings: `Welcome back` and `New to Kerb?`.
    - Intros: `We’ll save your quote and selected cover when you sign in. You’ll review your payment details next.` and `We’ll save your quote and selected cover when you create your account. You’ll review your payment details next.`
    - Aside: `Your cover is waiting` … `No payment is taken when you sign in or create an account.`
    - Buttons: `Sign in and continue to payment`, `Create account`, `Back to choose cover`.
    - Sign-up line: `We only use these details to run your account. Confirm your email after signing up, then return to payment.`
    - After sign-up: `Your quote is saved to your new account. Confirm your email, sign in, and you’ll find it under Your saved quotes.`
    - While saving: `Saving your quote…`.
  - **Car withdrawn:** `This car is no longer available on Kerb. Choose your car again.`
  - **Pay:**
    - Heading and intro: `Confirm and pay` and `Review your payment details, check your cover and complete the purchase.`
    - Start date: `When should your cover start?`.
    - Card: `Payment card`, with fields `Name on card`, `Card number`, `Expiry (MM / YY)` and `Security code`.
    - Tick boxes: `I confirm my details are correct` and `I agree to the policy terms and understand my cover`.
    - Buttons: `Pay {£total}` or `Pay {£payment} today`.
    - Declined: `Your card was declined. Try another card.`
    - Demo cards: `Demo cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.`
  - **Pay refusals:**
    - `Your account is closing, so you can’t buy a policy.`
    - `You’ve already bought this quote.`
    - `This quote has expired. Get a new quote to see today’s price.`
    - `This quote can’t be bought online.`
  - **You're covered:**
    - Badge and overline: `Payment successful` and `Car insurance · Purchase complete`.
    - Heading: `You’re covered`, then `Thanks, {first}. Your {tier lower-case} car insurance is confirmed.`
    - Annual payment line: `{£} paid annually · {Brand} ending {last4}`.
    - Monthly payment line: `{£} paid today, then 11 monthly payments of {£} · {Brand} ending {last4}`.
    - Email line: `A confirmation has been sent to {email}. You can also see your policy in your account.`
    - Button: `Go to my account`.
  - **Saved quotes:**
    - Overline: `Saved quotes · {first} {last}`. Heading: `Your saved quotes`.
    - Badges: `Ready to buy`, `Under review`, `Bought` and `Expired`. The other copy is as in spec decision 10.
    - Empty: `You don’t have any saved quotes yet.` with `Get a quote`.
- **Breakpoints and frame:** reuse 5.4b's `JourneyPage` and `quote.css`. The two columns stack below 960 px, and nothing scrolls sideways at 360 px.
- **Commits:**
  - Stage files by name.
  - Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`.
- **Before component tests or `vp build`:** check port 3000. If `vp dev` is running, ask Damion first.

## Review Focus

1. **Paying twice from two tabs with two different keys.** The second payment must be refused with `You’ve already bought this quote.`, not make a second policy (the `FOR UPDATE` on the quote, then the status check). Test in Task 5.
2. **A sign-up hook failure.** A thrown save inside Better Auth's `user.create.after` must not fail the sign-up response, and the tab must still hold the quote. Test in Task 4.
3. **The tab after a successful pay, Back pressed.** The cleared journey sends `/quote/car?step=buy` back to the start, never to a second save of an empty journey. Test in Task 7.
4. **A saved quote whose rating version is no longer active.** Pay and Saved quotes read the item's own version for `monthly_credit_charge_rate` and never the active one. Test in Task 6.
5. **A start date of 31 Jan, paid monthly.** The instalments fall on 28/29 Feb, 31 Mar, 30 Apr…, and the start date of 29 Feb ends on 28 Feb the next year. Test in Task 1.

---

### Task 1: Pure helpers: card, policy terms, schedule, saved key

**Files:**
- Create `src/features/quote/card.ts` and `card.test.ts`; `src/features/quote/policy-terms.ts` and `policy-terms.test.ts`.
- Modify `src/features/quote/journey-store.ts` (the `saved` part) and `journey-store.test.ts`.

**Interfaces (produces):**
- `checkCard(input: { name: string; number: string; expiry: string; code: string }, today: string): { ok: true; brand: CardBrand; last4: string } | { ok: false; fields: Partial<Record<"name"|"number"|"expiry"|"code", string>> }`
  - `CardBrand = "Visa" | "Mastercard" | "Amex" | "Card"`.
  - The number may contain spaces.
  - The expiry is `MM/YY` with or without spaces.
- `DECLINED_TEST_CARD = "4000000000000002"`
- `policyEndDate(startsOn: string): string`
- `instalmentDates(startsOn: string, count: number): string[]`
- `startDateBounds(today: string): { min: string; max: string; fallback: string }`
- `paymentSchedule(plan: "annual"|"monthly", totalPence: number, monthlyPaymentPence: number, startsOn: string): { instalmentNumber: number; amountPence: number; dueOn: string }[]`
- In `journey-store.ts`:
  - The optional part `saved: { quoteId: string; key: string }`.
  - `savedQuoteKey(journey: Journey): string`: a stable hash of the journey without `lastPlate`, `payment` and `saved`, with `cover` included. It's FNV-1a over sorted-key JSON, synchronous, which is enough to tell "changed" from "same". It isn't a security check.

- [ ] **Step 1: Write the failing tests.**
  - **card:**
    - `4242 4242 4242 4242` is ok, Visa, last4 `4242`.
    - `4242424242424241` gives `number: "Enter a valid card number."`.
    - Expiry `10/26` on `2026-11-13` gives `expiry: "This card has expired."`, and `11/26` is ok.
    - Code `12` gives `code: "Enter the 3 or 4 digit security code."`.
    - An empty name gives `name: "Enter the name on the card."`.
    - `5555 5555 5555 4444` is Mastercard; `3782 822463 10005` is Amex.
  - **policy-terms:**
    - `policyEndDate("2026-03-15")` is `"2027-03-14"`, and `("2028-02-29")` is `"2029-02-28"` (the anniversary of 29 Feb is 1 Mar, and cover ends the day before).
    - `instalmentDates("2027-01-31", 3)` is `["2027-01-31","2027-02-28","2027-03-31"]`.
    - `startDateBounds("2026-11-13")` is `{min:"2026-11-13",max:"2026-12-13",fallback:"2026-11-14"}`.
    - `paymentSchedule("monthly", 50_000, 4_584, "2026-12-01")` has 12 rows, each amount 4,584, the 12th due `2027-11-01`.
    - `paymentSchedule("annual", 50_000, …)` has 1 row of 50,000.
  - **saved key:**
    - Equal journeys give equal keys.
    - Changing `cover.coverLevel` or a driver's name changes the key; changing `lastPlate` or `payment` doesn't.
    - A stored `saved` part round-trips, and a bad one is dropped alone.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project unit src/features/quote/card.test.ts src/features/quote/policy-terms.test.ts src/features/quote/journey-store.test.ts`. Expected: FAIL, the modules don't exist yet.
- [ ] **Step 3: Implement.**
  - **Luhn**, 13–19 digits.
  - **Brand:** a leading `4` is Visa, `51`–`55` or `2221`–`2720` is Mastercard, `34`/`37` is Amex, anything else is `Card`.
  - **Dates** are `YYYY-MM-DD` strings with UTC arithmetic, as `schemas/dates.ts` does.
  - **The end date:** `policyEndDate` is the day before the start's anniversary. The anniversary of 29 Feb is 1 Mar, so a start on 29 Feb ends on 28 Feb.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): card checks, policy dates, payment schedule and the saved-quote key`.

### Task 2: Saving a car quote on the server

**Files:**
- Create `src/server/quote/car-check.ts`, which holds the journey checks moved out of `price.ts`.
- Create `src/server/quote/save.ts` and `save.int.test.ts`.
- Create `src/server/data/rate-limit-rules.ts`.
- Create `src/features/rating/car-details.ts` and `car-details.test.ts`.
- Modify `src/server/quote/price.ts` (it uses `car-check.ts`), `src/server/data/save-quote.ts` and its test, and `scripts/seed/*` if it calls `saveQuote`.

**Interfaces:**
- **Consumes:** `parseJourney`, `firstIncompleteStep`, `carInputsFromJourney`, `priceQuote`, `getCatalogue`, `getActiveRatingTables`, `quoteRows`/`SaveItem`/`CarDetails` (5.4), and `Journey`'s `cover` part (5.5).
- **Produces:**
  - `checkCarJourney(raw: unknown, now: Date): Promise<{ ok: true; journey: Journey; inputs: CarInputs; tables: RatingTables; car: CatalogueRecord; today: string } | { ok: false; step: "car" | DriverStep | "cover" }>`. Everything `priceCarJourney` checks today, in the same order. `priceCarJourney` keeps its result type and tests.
  - `carDetailsFromJourney(journey: Journey, car: RatedCar & { make; model; variant; doors; id }, today: string): CarDetails`:
    - **The main driver:** `licenceYears` from `licenceDate`, `noClaimsYears` as stored, and `pastClaims` = the main driver's incidents (0 when `claims.any` is false).
    - **Each named driver:** `noClaimsYears: 0` and `pastClaims` = `anyClaims ? pastClaims : 0`.
    - **The vehicle:** `registration` = the `demoPlate` or null, and `catalogueVariantId` = `car.id`.
    - **The usage:** `usage`/`overnightLocation`/mileages from `journey.usage`.
  - `saveQuote(db: Db | Tx, input, deps)`: when it's given a `Tx`, it runs inside it without opening its own. The reference retry then needs a savepoint: wrap each attempt in `tx.transaction(...)` (Drizzle nests as a savepoint).
  - `saveCarQuoteFor(tx: Tx, userId: string, input: { journey: unknown; now?: Date }): Promise<SaveCarResult>`, where `SaveCarResult = { status: "saved"; quoteId: string; reference: string; outcome: "quoted"|"referred" } | { status: "invalid"; step: "car"|DriverStep|"cover" } | { status: "declined" } | { status: "staff" }`. It:
    - refuses a user with a `staff_members` row;
    - finds the user's customer, or inserts one from `mainDriver` and the postcode (decision 4);
    - prices with `coverLevel` = `usableCover(...)`'s tier, `addons` = the chosen extras, at `cover.voluntaryExcessPence`;
    - saves with `startDate` = tomorrow (London);
    - doesn't save a declined quote.
  - `QUOTE_SAVE_RULE` and `QUOTE_PAY_RULE` in `rate-limit-rules.ts`.
  - `saveCarQuote: DataWrite<SaveCarResult>` = `defineWrite(z.object({ journey: z.unknown() }), { limit: { action: "quote.save", rule: QUOTE_SAVE_RULE }, idempotent: { action: "quote.save" } }, (actor, { journey }, tx) => ...)`. `staff` maps to `rejected("Staff accounts can't buy policies.")`.
  - The server function `saveQuoteFn` in `src/features/quote/server.ts`, with `actorMiddleware` and a `{ input, idempotencyKey }` envelope.

- [ ] **Step 1: Write the failing tests.**
  - **`car-details.test.ts`:** the e2e journey fixture (`journey-fixtures.ts`) maps to the expected `CarDetails` (written by hand), and a named driver with claims "No" stores 0.
  - **`save.int.test.ts`:**
    - **The customer:** the first save makes a customer from About you; a second save with a changed address keeps the first customer row unchanged.
    - **Re-pricing:** the saved `totalPence` equals `composeCover(priceCarJourney(...))`'s total for the same choice, and adding `price: 1` anywhere in the request changes nothing.
    - **A withdrawn car:** a deactivated catalogue row answers `{status:"invalid",step:"car"}` and writes nothing.
    - **A referred journey** (three claims) saves with status `referred`; a declined one (an Isle of Man postcode) answers `declined` and writes nothing.
    - **Staff:** a staff user answers `staff`, with no customer row.
    - **`saveCarQuote` replays:** the same key twice gives one quote.
    - **The rate limit:** the 21st call in an hour throws `RateLimitError`.
  - **`save-quote.int.test.ts`:** a new case where `saveQuote(tx, …)` inside an outer transaction that then throws leaves no rows.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project unit src/features/rating/car-details.test.ts` and `vp test --project int src/server/quote/save.int.test.ts src/server/data/save-quote.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Move the checks out of `price.ts` without changing its behaviour.
- [ ] **Step 4: Run the tests above plus `src/server/quote/price.int.test.ts`.** Expected: PASS, with price's tests unchanged.
- [ ] **Step 5: Commit** `feat(quote): save a car quote on the server, re-priced, with the customer row`.

### Task 3: Owner-only reads for saved quotes, pay and You're covered

**Files:**
- Create `src/server/data/quotes.ts` and `quotes.int.test.ts`.
- Modify `src/server/data/index.ts` (export) and the permission suite's list (`permissions.int.test.ts`), so each new read is attacked as every kind of user.

**Interfaces (produces), each a `defineRead("signed_in", …)` that filters by `actor.customerId`; any other quote is `NOT_FOUND`:**
- `listMyQuotes(): SavedQuoteCard[]`, newest first:
  - `SavedQuoteCard = { quoteId; reference; state: "ready"|"review"|"bought"|"expired"; car: { make; model; variant; registration: string|null }; coverLevel: string|null; annualTotalPence: number|null; monthlyPaymentPence: number|null; policyReference: string|null; postcode: string }`.
  - **The state:** `accepted` → bought; else `validUntil < now` → expired; `referred` → review; `priced` → ready. Declined quotes aren't listed.
- `getQuoteForPayment({ quoteId }): PaymentSummary`:
  - `PaymentSummary = { quoteId; reference; status; expired: boolean; policyholder: { firstName; lastName }; car: {...}; coverLevel; compulsoryExcessPence; voluntaryExcessPence; annualTotalPence; monthlyPaymentPence; startDate; addons: string[] }`.
  - **The money:** `monthlyPaymentPence = monthlyPayment(quote.totalPence, rate)`, where `rate` is the item's own rating version's `monthly_credit_charge_rate` (`getRatingTables(db, item.ratingVersionId)`).
- `getPurchase({ quoteId }): Purchase` (only for an `accepted` quote):
  - `Purchase = { firstName; email; plan; card: { brand; last4 }; firstPaymentPence; monthlyPaymentPence|null; policies: { reference; product; coverLevel; startsOn; endsOn; compulsoryExcessPence; voluntaryExcessPence; car: {...}|null }[] }`.

- [ ] **Step 1: Write the failing tests.**
  - Two customers, each with a quote. Each lists only their own quote, and the other's id is `NOT_FOUND` from both detail reads.
  - Each state's badge comes from the right status and date.
  - A quote saved under rating v1, read after a v2 is activated with a different credit charge, still shows v1's monthly payment.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project int src/server/data/quotes.int.test.ts src/server/data/permissions.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `db.query` and the relations, as `policies.ts` does.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): owner-only reads for saved quotes, payment and purchase`.

### Task 4: Sign-up saves the quote; unconfirmed accounts are cleaned up

**Files:**
- Modify `src/server/auth/auth.ts` (the `user.create.after` hook).
- Modify `src/server/data/job-rows.ts` (`deleteExpiredRows` gains `unconfirmedUsers`) and its int test, so the 7-day cleanup runs in the existing `housekeeping.expired_rows` daily job. No new job type.
- Test in `src/server/auth/signup-quote.int.test.ts`.

**Interfaces:**
- **The sign-up body** carries an extra field `quote: { journey: unknown }`.
- **In `user.create.after`**, when `ctx?.path === "/sign-up/email"` and `ctx.body?.quote` is present:
  - check `limit("quote.save:" + rateLimitSubject(null, headers), QUOTE_SAVE_RULE)`;
  - then `withTx(getDb(), tx => saveCarQuoteFor(tx, user.id, { journey }))`;
  - wrapped in `try/catch` that logs with `logSafeError` (never the journey) and swallows.
- **`deleteExpiredRows`** also deletes `users` with `emailVerified = false`, `createdAt < now − 7 days`, and no `staff_members` row. It returns the count.

- [ ] **Step 1: Write a probe test** that calls `auth.api.signUpEmail({ body: { name, email, password, acceptTerms: true, quote: { journey } }, headers })` with Turnstile's test secret. It asserts the hook sees `ctx.body.quote`.
  - **If Better Auth strips unknown body keys,** stash the body's `quote` in the existing `hooks.before` for `/sign-up/email` into an `AsyncLocalStorage` that the after-hook reads.
  - **Record which way it went** as a plan deviation in the spec's notes.
- [ ] **Step 2: Write the failing tests.**
  - A new email gives one user, one customer and one quote, with status `priced`.
  - An existing confirmed email gives no new quote on that user (`onExistingUserSignUp` path).
  - A journey that fails the checks gives the user with no customer or quote, and the response is still ok.
  - A forced throw in `saveCarQuoteFor` (stubbed) gives an ok response, and the user exists.
  - **The cleanup:**
    - an unconfirmed user aged 8 days is gone, with their customer and quote;
    - an unconfirmed user aged 6 days stays;
    - a confirmed user aged 30 days stays;
    - an unconfirmed staff user stays.
- [ ] **Step 3: Run them and see them fail.** Run `vp test --project int src/server/auth/signup-quote.int.test.ts src/server/data/job-rows.int.test.ts` (or wherever `deleteExpiredRows` is tested). Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run them and see them pass.** Then run `vp test --project int src/server/auth` to check nothing in sign-up regressed. Expected: PASS.
- [ ] **Step 6: Commit** `feat(auth): creating an account mid-quote saves the quote; unconfirmed accounts are deleted after 7 days`.

### Task 5: Paying: `payForQuote`

**Files:**
- Create `src/server/quote/pay.ts` and `pay.int.test.ts`.
- Modify:
  - `src/server/audit/actions.ts`: add `"policy.purchased": { entityType: "policy", description: "A customer bought a policy" }`, and update the snapshot.
  - `src/server/email/templates.ts` and `registry.ts`: `policy_confirmed` with params `{ name, policyReference, car, startsOn, endsOn, amount, url }`.
  - `src/features/quote/server.ts`: add `payFn`.

**Interfaces:**
- **Consumes:** `checkCard`, `DECLINED_TEST_CARD`, `startDateBounds`, `policyEndDate`, `paymentSchedule` (Task 1); `QUOTE_PAY_RULE` (Task 2); `getAccountState` (4.7); `audit`, `queueEmail`.
- **Produces:**
  - `payForQuote: DataWrite<{ quoteId: string; policyReferences: string[] }>`. Its input schema is `{ quoteId: uuid, plan: "annual"|"monthly", startsOn: date string, card: { name, number, expiry, code }, detailsConfirmed: literal(true), coverAcknowledged: literal(true) }`.
  - **Order of work:**
    1. Check the card and start-date bounds, and return `rejected(message, fields)` on failure.
    2. Reject `DECLINED_TEST_CARD` with `card.number: "Your card was declined. Try another card."`. Nothing is written.
    3. Then, in the transaction, take spec decision 7's steps 1–8 in order. The locks are `select … for update` on `customers` (by `actor.customerId`; null means not found) and on `quotes`.
  - **Money:**
    - `annualPremiumPence` per policy is the selected option's `annual_premium_pence` plus the selected add-ons' `annual_price_pence`.
    - The payment amounts come from `quotes.total_pence`, and the monthly payment is `monthlyPayment(total, rate of the item's version)`.
  - **The audit `changes`:** `{ quoteReference, plan, amountPence }`.
  - **The email:** to the user's email, with `url` `${baseURL}/account`.

- [ ] **Step 1: Write the failing tests.** Seed a priced car quote for a customer with Task 2's `saveCarQuoteFor`.
  - **Annual:** one policy (`KRB-\d{6}`, the dates, the excesses), one `succeeded` payment with `paid_at`, the quote `accepted` with both confirmation times and the plan, the item's `start_date` updated, one `policy.purchased` audit row, and one `email.send` job.
  - **Monthly:** 12 payments, the first `succeeded`, 2–12 `scheduled` with `instalmentDates` due dates.
  - **Idempotency:**
    - the same key twice gives one policy and the same response;
    - a different key after success gives `You’ve already bought this quote.`;
    - two concurrent calls with different keys (`Promise.all`) give exactly one policy.
  - **Rollback:** a stubbed `audit` that throws after the policy insert leaves no policy, payment, bundle, audit or job rows, and the quote stays `priced`.
  - **Refusals:** expired (`validUntil` in the past), referred, another customer's quote (`NOT_FOUND`), and an account with a pending closure (`Your account is closing…`).
  - **Bundle:** a car-and-home quote saved with `saveQuote` from `save-quote.int.test.ts`'s fixtures gives one `bundles` row and two policies pointing at it.
  - **No card leakage:** after a pay, `select` every text column of `idempotency_keys`, `audit_log`, `jobs` and `payments`. None contains `4242424242424242` or the code.
  - **Declined card:** no rows at all.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project int src/server/quote/pay.int.test.ts src/server/audit`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): pay for a quote in one transaction: policy, payments, bundle, audit and email`.

### Task 6: The gate (`step=buy`), Save and exit, and the referred button

**Files:**
- Create `src/features/quote/BuyGate.tsx` and `buy.browser.test.tsx`.
- Modify:
  - `src/features/quote/search.ts`: add `"buy"` to `QUOTE_STEPS` and `auth?: "signup"` to `CarSearch`.
  - `src/features/quote/DriverSteps.tsx`: route `buy`, with the same quoted-and-chosen guard as `cover`.
  - `frame.ts`: the Stepper shows "Buy" for `step=buy`.
  - `src/features/auth/LoginForm.tsx` and `SignUpForm.tsx`: optional props `title`, `extraLine`, and for sign-up `quote?: { journey: Journey }`, sent in the sign-up body. The defaults stay as they are.
  - `AddHome.tsx`: "Continue with car only" goes to `step=buy`.
  - `Outcomes.tsx`: "Sign in to send this for review" goes to `step=buy`, then to `/quote/retrieve` after the save.
  - `QuoteHolding.tsx` and `ChooseCover.tsx`: add a "Save and exit" secondary button.
  - The tests in `cover.browser.test.tsx` and `drivers.browser.test.tsx` that expect the 5.6 holding lines.

**Interfaces:**
- **Consumes:** `saveQuoteFn` (Task 2); `useIdempotencyKey("quote.save")`, `writeOutcome`; `savedQuoteKey` and the `saved` part (Task 1); `getSessionUser` (via a `useSession`-style call already used by the auth pages).
- **Produces:** `BuyGate` with props `{ journey: Journey; prices: CoverPrices; after: "pay" | "retrieve"; onInvalid(step): void }`. When signed in, it:
  - reuses `saved.quoteId` if `saved.key === savedQuoteKey(journey)`;
  - otherwise calls `saveQuoteFn`, stores `saved`, and navigates to `/quote/pay/$quoteId` or `/quote/retrieve`.
  - **`invalid`** calls `onInvalid`, and for `car` shows the withdrawn-car line on the car step.
  - **`staff`/`rejected`** shows the message.
  - **`declined`** can't happen here, because the guard needs a quoted journey; it shows `writeOutcome`'s generic line.

- [ ] **Step 1: Write the failing component tests** with `renderWithRouter`, the 5.5 fixtures, and the server function mocked:
  - a guest sees `Sign in before you pay`, and the switch to `Create your account to continue` sets `auth=signup`;
  - the aside shows the tier, the price for the chosen plan and the total excess, with no "Cover starts";
  - signed in, it shows `Saving your quote…`, then navigates to `/quote/pay/<id>`;
  - a second visit with an unchanged journey doesn't call the server; a changed cover does;
  - `invalid`/`car` lands on the car step with the withdrawn line;
  - Save and exit on Your quote ends on `/quote/retrieve`;
  - the referred screen's button goes to `step=buy`;
  - after Create account, the "Check your inbox" panel shows the added quote line;
  - sign-up sends `quote.journey` in the body;
  - an empty journey on `step=buy` goes to `/quote?type=car`.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project component src/features/quote/buy.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Run `vp test --project component src/features/quote src/features/auth`. Expected: PASS, with the updated holding-line tests.
- [ ] **Step 5: Commit** `feat(quote): sign in or create an account at Buy without losing the quote; Save and exit`.

### Task 7: Confirm and pay, and You're covered

**Files:**
- Create `src/routes/_quote/quote.pay.$quoteId.tsx` and `quote.covered.$quoteId.tsx`.
- Create `src/features/quote/PayPage.tsx`, `CoveredPage.tsx` and `pay.browser.test.tsx`.
- Modify `src/features/quote/server.ts` (the `getQuoteForPaymentFn` and `getPurchaseFn` reads, with `actorMiddleware`), `frame.ts` (the Stepper on "Buy" for both) and `quote.css`.

**Interfaces:**
- **Consumes:** `payFn` (Task 5); `PaymentSummary`/`Purchase` (Task 3); `checkCard`/`startDateBounds` (Task 1); `useIdempotencyKey("quote.pay:" + quoteId)`; `PayChoice` (5.4b).
- **Produces:**
  - **The routes** use `requireSignedIn(location)` in `beforeLoad` and `Cache-Control: private, no-store`.
  - **A `NOT_FOUND` read** throws the router's `notFound()`.
  - **An accepted quote on the pay route** redirects to `/quote/covered/$quoteId`.
  - **After a successful pay:** rotate the key, clear `kerb.quote.v1.car` from the journey store, and navigate (replace) to covered.
  - **"Back to choose cover"** goes to `/quote/car?postcode=…&step=cover` when the tab's `saved.quoteId` is this quote, and otherwise to `/quote/retrieve`.

- [ ] **Step 1: Write the failing component tests.**
  - The date input has `min`/`max` from `startDateBounds`, and a date past `max` shows `Choose a date within the next 30 days.`.
  - The card errors show on submit.
  - Both boxes are required: `Confirm your details are correct.` and `Agree to the policy terms to continue.`.
  - The button reads `Pay £458.40`, then `Pay £42.02 today` after choosing monthly.
  - A declined card shows the line on the card number field.
  - **A refusal from the server** shows its message under the button. "Already bought" links to covered.
  - **Covered** renders the annual and monthly payment lines, the email line, and `Go to my account` linking to `/account`, with no documents section.
  - After a pay, the tab's car journey is empty, and `/quote/car?step=buy` goes to `/quote?type=car`.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project component src/features/quote/pay.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): Confirm and pay with a demo card, and You're covered`.

### Task 8: Your saved quotes and "Your policies" on `/account`

**Files:**
- Create `src/routes/_quote/quote.retrieve.tsx`, `src/features/quote/SavedQuotes.tsx` and `saved-quotes.browser.test.tsx`.
- Modify `src/features/auth/AccountPage.tsx`, `src/routes/account.tsx` (load `listMyPolicies` alongside the summary) and `account.browser.test.tsx`.

**Interfaces:**
- **Consumes:** `listMyQuotes` (Task 3) through a `listMyQuotesFn`; `listMyPolicies` (4.5).
- **Produces:**
  - **Saved quotes:** one card per `SavedQuoteCard`, with the buttons from spec decision 10. "Continue quote" goes to `/quote/pay/$quoteId`. "Start a new quote" goes to `/quote?type=car&postcode=<postcode>`.
  - **On `/account`:** a "Your policies" section (each policy's reference, `{Product} · {Tier}`, its status, and `{startsOn} to {endsOn}`) and a link, `Your saved quotes`, to `/quote/retrieve`.
  - **With no policies,** the section reads `You don’t have any policies yet.`

- [ ] **Step 1: Write the failing component tests.**
  - Each of the four states renders its badge, copy and button.
  - The empty state.
  - The account page lists two policies and links to saved quotes.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project component src/features/quote/saved-quotes.browser.test.tsx src/features/account src/features/auth`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): Your saved quotes, and your policies on the account page`.

### Task 9: The end-to-end journey, axe, docs, and the full check

**Files:**
- Create `e2e/buy.spec.ts`.
- Modify `e2e/a11y.spec.ts` if the quote pages are listed there.
- Modify the docs: `plan/figma.md`, `plan/phases/05-quote/phase.md`, `plan/build-plan.md`, `plan/engineering.md` (the rate-limit row), and the spec's Status and Done-when.

- [ ] **Step 1: Write `e2e/buy.spec.ts`** at 390 px, skipped without `E2E_DATABASE_URL`, as `account-close.spec.ts` is.
  1. `withCompleteJourney`, then Your quote → Choose cover → Continue → Continue with car only.
  2. Create an account at the gate, with a unique `e2e+buy-<time>@…` address.
  3. Confirm the email in the database with `account-close.spec.ts`'s `confirmEmailInDatabase` (move it to `e2e/db.ts` and import it in both).
  4. Log in at `/login?redirect=/quote/retrieve`.
  5. Check the saved quote shows `Ready to buy`, then press Continue quote.
  6. Choose monthly, enter `4242 4242 4242 4242`, `12/30` and `123`, tick both boxes, and pay.
  7. Check `You’re covered` shows with a `KRB-` reference.
  8. Check `/account` lists the reference.
  9. Check `/quote/retrieve` shows `Bought`.
  - **Axe** (`expectNoSeriousAxeViolations`) runs on the gate, pay, covered and saved quotes at 390, 768 and 1440 px.
- [ ] **Step 2: Run** `vp check`, `vp test` and `vp build` (check port 3000 first), then `pnpm exec playwright test e2e/buy.spec.ts` against `vp preview` with `E2E_DATABASE_URL` set to `dev`. Expected: all green.
- [ ] **Step 3: Update the docs.**
  - **`figma.md`:** screens 14, 15, 17 and 18 and the Purchase frame marked built in 5.6, with the changed copy (no "Quote saved" badge or "Cover starts" on 14 and 15, the intro reworded, two tick boxes, documents waiting for 6.2).
  - **`phase.md`'s 5.6 row:** `done (#NN)`.
  - **`build-plan.md`:** the 5.6 box ticked.
  - **`engineering.md`:** the rate-limit row names `quote.save` (20/h) and `quote.pay` (10/h).
  - **The spec:** Status `done`, plus any plan deviations (Task 4's probe result).
- [ ] **Step 4: Commit** `test(quote): buy journey E2E and axe; docs for 5.6`.
- [ ] **Step 5: Open the PR into `staging`** following `plan/git-workflow.md`:
  - the title is the spec's commit message;
  - the body uses the template, links the spec, and copies Done-when;
  - the body ends with the Opsed Solutions co-author line and the Claude Code line.
  - Damion runs the manual check on the preview.
