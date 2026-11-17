# 5.7b Car + home bundle: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** car and home bought together as one quote with the 8% saving. The bundle starts from car's screen 21, or from home's Choose cover through car. Screen 22's panel shows both prices, and one gate, one Stripe checkout and two policies under one `bundles` row follow.

**Architecture:**
- **The bundle lives in the tab as a mark on the home journey** (`bundle: { carJourneyId }`). A pure `bundleState(car, home)` decides whether it's live, and `composeBundle()` adds up both choices with the engine's `quoteTotals()`.
- **The home route does the bundle work:** Choose cover's panel, the bundle outcomes (03 and 04 with "Continue with car only") and the gate's bundle save. Car's route only gains the live links: screen 21, screen 20's halves and 19's "Continue with home only".
- **On the server:**
  - `saveBundleQuoteFor` saves one quote with both items;
  - the reads and purchase stop assuming one item: `monthlyPaymentFor` over every version, discounted premiums per policy, `PaymentSummary.items`, `SavedQuoteCard.items`, and the email's home line.

**Tech Stack:** TanStack Start (server functions, file routes), React, TanStack Query, Zod 4, Drizzle on Postgres, Stripe, Vitest (projects `unit`, `integration`, `component`), Playwright.

**Spec:** [07b-bundle.md](07b-bundle.md). Read all 8 decisions and "What exists already" first.

## Global Constraints

- **Car alone and home alone must not change behaviour.** Every existing test passes. Where a type goes from one item to a list, the single-item callers read the list's only entry.
- **No migration.** The schema already holds a two-item quote and a bundle.
- **Copy, exactly as the spec gives it:**
  - `Insure your car with us too and save {8}% on both.` and the button `Add car insurance`;
  - the panel's heading `Your car quote`, the lines `Car`, `Home` and `Bundle saving`, then `Together: {£X} a year` and `Or 12 combined payments of {£Y}`;
  - the buttons `Continue to sign in`, `Continue with home only` and `Continue with car only`;
  - the save's message `Your name and date of birth must match your car quote.`;
  - Stripe's line `Kerb car + home insurance, {car tier} and {home tier}, {plate or make and model} and {address line 1}`.
- **The bundle rate and the monthly rate come from the versions** (`bundle_discount_rate`, `monthly_credit_charge_rate`), never a literal 8 or 10.
- **Commits:** each ends with both trailers:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name. Never stop `vp dev` to run tests; check port 3000 is free before component tests or a build.
- **Execution mix:** inline, with a Sonnet review after Task 4 (server) and after Task 8 (screens), then one whole-branch review before the PR.

## Review Focus

1. **A stale mark:** the home journey says "bundled with car journey X", but the tab's car journey is a new one (restarted), gone (paid), or no longer quoted. The bundle must be off everywhere: home runs alone, and nothing saves a bundle. *Tests in Tasks 1 and 7.*
2. **The price moving between the panel and the save.** The figures on screen 22 must equal what `saveBundleQuoteFor` stores, for annual and monthly, with extras on both. *Tests in Tasks 1 and 3.*
3. **Car and home answered by different people,** or the same person typed differently ("alex" vs "Alex"). Names compare trimmed and case-blind, and dates of birth exactly; a mismatch reopens home's About you with the message. *Test in Task 3.*
4. **Paying for a bundle, then opening either journey:** both are cleared, so neither route re-offers a quote that's already bought. *Test in Task 8.*
5. **An old single-item quote after the reshape:** Your saved quotes, Confirm and pay and You're covered still show a car-only and a home-only quote as before. *Tests in Tasks 4 and 8.*

---

### Task 1: The mark in the tab, and the bundle's money

**Files:**
- Create: `src/features/quote/bundle.ts`, `src/features/quote/bundle.test.ts`
- Modify: `src/features/quote/journey-store.ts` (the `bundle` part and its setters), `journey-store.test.ts`

**Interfaces:**
- **Produces, from `journey-store.ts`:**
  - `Journey` gains `bundle?: { carJourneyId: string }` (read on its own, as every part is);
  - `markBundle(carJourneyId: string, storage?)` sets it on the home journey; `clearBundle(storage?)` removes it;
  - `savedQuoteKey` ignores `bundle`.
- **Produces, from `bundle.ts`:**
  - `bundleLive(car: Journey | null, home: Journey | null): boolean`: true when `home.bundle.carJourneyId === car.journeyId` and car has a `cover`;
  - `composeBundle(car: { prices: CoverPrices; cover: CoverChoice }, home: { prices: CoverPrices; cover: CoverChoice }): BundleMoney | null`, where `BundleMoney = { car: { totalPence: number; discountPence: number }; home: { totalPence: number; discountPence: number }; savingPence: number; totalPence: number; monthlyPaymentPence: number }`. It's null when either tier can't be chosen. It uses `quoteTotals()` with both lines and `monthlyPayment()` with the shared rate, and throws when the two monthly rates differ;
  - `prefillAbout(from: Journey | null): { firstName: string; lastName: string; dateOfBirth: string } | undefined`: car's `mainDriver` or home's `homeAbout`, whichever exists;
  - `samePerson(a, b): boolean`: names trimmed and case-blind, dates of birth exact.

- [ ] **Step 1: Write the failing tests.**
  - `journey-store.test.ts`:
    - `markBundle("c1")` then `readJourney("home")!.bundle` equals `{ carJourneyId: "c1" }`;
    - `clearBundle()` removes it;
    - a stored `bundle` that doesn't parse is dropped alone, and the rest of the home journey stays.
  - `bundle.test.ts`:
    - `bundleLive` is true for a matching id with a car cover;
    - it's false for a different id, no car journey, no mark, or a car with no `cover`.
    - `composeBundle` with the `cover-fixtures.ts` car and home prices at Comprehensive:
      - `savingPence` equals `priceQuote([car, home])`'s `bundleDiscountPence` for the same choice;
      - `totalPence` equals its `totalPence`, also with one extra on each.
    - `composeBundle` throws when the monthly rates differ.
    - `samePerson` matches `" alex "` and `"Alex"`, and fails on another date of birth.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/bundle src/features/quote/journey-store`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say. `composeBundle` reuses `composeCover`'s line building, so pull its `TotalsLine` construction into a helper `coverLine(product, prices, coverLevel, addons): TotalsLine | null` in `cover.ts`, and have `composeCover` call it.
- [ ] **Step 4: Run** the same command, plus `vp test --project unit src/features/quote/cover`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): the bundle mark in the tab, and a bundle's money from both choices`

### Task 2: Purchase and the monthly rate over every item, and the email's home line

**Files:**
- Modify:
  - `src/server/data/pay-quote.ts`: `monthlyPaymentFor` and `purchaseItems`;
  - `src/server/quote/purchase.ts`, `src/server/quote/checkout.ts`, `src/server/data/quotes.ts` (the four callers);
  - `src/server/email/registry.ts`, `src/server/email/templates.ts`;
  - `src/server/quote/purchase.int.test.ts`, `src/server/email/registry.test.ts`.

**Interfaces:**
- **Produces:**
  - `monthlyPaymentFor(db: Db | Tx, ratingVersionIds: readonly string[], totalPence: number): Promise<number>`. It throws `Error("monthly_credit_charge_rate differs between items")` when the versions disagree.
  - `PurchaseItem.annualPremiumPence` is the item's premium and add-ons **after its share** of the bundle discount (`splitBundleDiscount` over the items' option premiums and the first item's `bundle_discount_rate`). A single item is unchanged.
  - `policy_confirmed` params gain `home: z.string()` (the address line 1 and postcode, or `""`). The template prints a "Home" line when it's set, as it prints "Car".

- [ ] **Step 1: Write the failing tests.** In `purchase.int.test.ts`, with a saved two-item quote (build it with `saveQuote` and the fixtures used by 5.6's bundle test):
  - one `bundles` row;
  - two policies with the same `startsOn`;
  - the two policies' `annual_premium_pence` add up to the quote's `subtotal_pence - bundle_discount_pence`;
  - the payment schedule totals `quotes.total_pence`;
  - the queued email's params have both `car` and `home` set.

  Then:
  - `monthlyPaymentFor` with two versions whose monthly rates differ throws (insert a test version with `0.12`);
  - `registry.test.ts`: `policy_confirmed` renders a Home line when `home` is set and none when it's `""`.
- [ ] **Step 2: Run** `vp test --project integration src/server/quote/purchase` and `vp test --project unit src/server/email`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the four `monthlyPaymentFor` callers to pass every item's `ratingVersionId`.
- [ ] **Step 4: Run** both commands again, plus `vp test --project integration src/server`. Expected: PASS, car and home alone unchanged.
- [ ] **Step 5: Commit.** `feat(pay): a bundle's policies carry their discounted premiums, one monthly rate for both, and the email names the home`

### Task 3: Saving a bundle, from the gate or a sign-up

**Files:**
- Create: `src/server/quote/bundle-save.int.test.ts`
- Modify: `src/server/quote/save.ts`, `src/features/quote/server.ts`, `src/server/auth/auth.ts`, `src/server/auth/signup-quote.int.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `samePerson`; `checkCarJourney`, `checkHomeJourney`, `coverPrices`, `priceQuote`, `customerForQuote`, `saveQuote`.
- **Produces:**
  - `type SaveBundleResult = { status: "saved"; quoteId: string; reference: string } | { status: "invalid"; product: "car" | "home"; step: string } | { status: "not_quoted"; product: "car" | "home"; outcome: "referred" | "declined" } | { status: "mismatch" }`;
  - `saveBundleQuoteFor(tx, userId, { car: unknown; home: unknown; now? }): Promise<SaveBundleResult>`;
  - `saveBundleQuote` (a `defineWrite` with `quote.save`'s limit and idempotency) and `saveBundleQuoteFn` (the same envelope as `saveHomeQuoteFn`);
  - **the sign-up body's quote** becomes `{ product?: "car" | "home"; journey } | { product: "bundle"; car; home }`.

- [ ] **Step 1: Write the failing tests** in `bundle-save.int.test.ts`:
  - `CAR_JOURNEY` and `HOME_JOURNEY` (with the same About you as car's main driver) save one quote with two items:
    - a `vehicles` row and a `properties` row;
    - `prior_claims` rows for home's claims;
    - `quotes.bundle_discount_pence > 0`;
    - `quotes.postcode` is car's.
  - The stored `total_pence` equals Task 1's `composeBundle` for the same choices, with one extra on each.
  - Rebuild `2500000` → `{ status: "not_quoted", product: "home", outcome: "declined" }`, and nothing is saved.
  - Rebuild `1000000` → `not_quoted` and `referred`, and nothing is saved.
  - Home's About you with another date of birth → `mismatch`, and nothing is saved.
  - A car journey without `vehicle` → `invalid`, `product: "car"`.
  - Two calls with one idempotency key through `saveBundleQuote` give one quote.

  In `signup-quote.int.test.ts`: a sign-up with `{ product: "bundle", car, home }` leaves one quote with two items.
- [ ] **Step 2: Run** `vp test --project integration src/server/quote/bundle-save src/server/auth`. Expected: FAIL.
- [ ] **Step 3: Implement** `saveBundleQuoteFor` beside `saveHomeQuoteFor`. Pull each product's check, price and chosen cover into helpers shared with the single saves. The customer comes from car's main driver, as `saveCarQuoteFor` does. Each item's `details` come from `carDetailsFromJourney` and `homeDetailsFromJourney`.
- [ ] **Step 4: Run** the same command, then `vp test --project integration src/server`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): save car and home as one quote with the bundle saving, from the gate or a sign-up`

### Task 4: The reads list a quote's items, and Stripe names a bundle

**Files:**
- Modify: `src/server/data/quotes.ts`, its int test, `src/server/quote/checkout.ts`, `checkout.int.test.ts`; fix the compile in `PayPage.tsx`, `SavedQuotes.tsx` and `CoveredPage.tsx` (rendering comes in Task 8).

**Interfaces:**
- **Produces:**
  - `interface QuoteItemSummary { product: "car" | "home"; car: CarSummary | null; home: PropertySummary | null; coverLevel: string | null; compulsoryExcessPence: number; voluntaryExcessPence: number; addons: string[] }`;
  - `PaymentSummary` replaces `car`, `home`, `coverLevel`, `compulsoryExcessPence`, `voluntaryExcessPence` and `addons` with `items: QuoteItemSummary[]` (in saved order), and gains `bundleSavingPence: number`;
  - `SavedQuoteCard` replaces `car`, `home` and `coverLevel` with `items: QuoteItemSummary[]`, and `policyReference` with `policyReferences: string[]`;
  - checkout's `lineName` gives the bundle line from the Global Constraints when there's a car and a home item.

- [ ] **Step 1: Write the failing tests:**
  - `getQuoteForPayment` on a bundle has two items, car first, and `bundleSavingPence` equals the quote's `bundle_discount_pence`;
  - on a car-only quote it has one car item and a saving of 0;
  - `listMyQuotes` shows a bundle as one card with two items, and after purchase both policy references;
  - the checkout session's line name for a bundle is `Kerb car + home insurance, Comprehensive and Comprehensive, KR24 BXL and 18 Albion Road`.
- [ ] **Step 2: Run** `vp test --project integration src/server/data/quotes src/server/quote/checkout`. Expected: FAIL.
- [ ] **Step 3: Implement it,** then make `vp check` pass by reading `items[0]` in the three pages for now.
- [ ] **Step 4: Run** the tests above, `vp check`, and `vp test --project component src/features/quote/pay src/features/quote/saved-quotes`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): pay, saved quotes and checkout read every item on a quote`
- [ ] **Step 6: Checkpoint review** (Sonnet) on Tasks 1–4: money, idempotency, and the single-item paths unchanged.

### Task 5: Home's Choose cover: the bundle panel and "Add car insurance"

**Files:**
- Create: `src/features/quote/BundlePanel.tsx`, `src/features/quote/bundle.browser.test.tsx`
- Modify: `src/features/quote/ChooseCover.tsx`, `src/features/quote/HomeSteps.tsx`, `src/features/quote/quote.css`

**Interfaces:**
- **Consumes:** Task 1's `bundleLive`, `composeBundle`, `markBundle` and `clearBundle`; `priceQuery("car", carJourney)` for the car's prices.
- **Produces:**
  - `ChooseCover` gains optional `bundle?: { car: Journey; onHomeOnly: () => void; onBackToCar: () => void }` and `onAddCar?: () => void`;
  - when `bundle` is set, the page's main button reads `Continue to sign in`, and `BundlePanel` sits under the breakdown;
  - when `onAddCar` is set and `bundle` isn't, the offer line shows under the extras;
  - a payment choice made on a bundle calls `setPayment` for both products.

- [ ] **Step 1: Write the failing component tests** in `bundle.browser.test.tsx` (prices mocked as in `cover.browser.test.tsx`):
  - with a live bundle, the panel shows `Your car quote`, the car's tier, `Car`, `Home`, `Bundle saving` and `Together: £X a year` with `composeBundle`'s figures;
  - choosing Monthly sets `payment` on both journeys;
  - `Continue with home only` clears the mark and moves to `buy`;
  - without a bundle, `Add car insurance` marks the bundle with the car journey's id and navigates to `/quote/car?postcode=…`;
  - a stale mark (another car id) shows no panel and shows the offer line.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/bundle`. Expected: FAIL.
- [ ] **Step 3: Implement.** `HomeSteps` reads both journeys and passes `bundle` when `bundleLive`, or `onAddCar` otherwise. `onAddCar` calls `beginJourney("car", postcode)`, then `markBundle(car.journeyId)`, then navigates. `onBackToCar` goes to `/quote/car?step=cover`.
- [ ] **Step 4: Run** the same command, plus `vp test --project component src/features/quote/cover src/features/quote/home`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): home's Choose cover shows the bundle with the car beside it, or offers to add car`

### Task 6: Car's side: screen 21 live, screens 20 and 19, and About you filled in

**Files:**
- Modify: `src/features/quote/AddHome.tsx`, `src/features/quote/DriverSteps.tsx`, `src/features/quote/QuoteHolding.tsx`, `src/features/quote/Outcomes.tsx` (19's link), `src/features/quote/AboutYouStep.tsx`, `src/features/quote/HomeAboutStep.tsx`, `src/features/quote/quote.browser.test.tsx`, `src/features/quote/home.browser.test.tsx`

**Interfaces:**
- **Consumes:** Task 1's `markBundle`, `bundleLive`, `prefillAbout`; `firstIncompleteHomeStep`.
- **Produces:**
  - `AddHome`'s button calls `onAddHome(postcode)`. `DriverSteps` starts the home journey, marks it, and navigates to `/quote/home?postcode=…&step=cover` when `firstIncompleteHomeStep` is null, or to that step otherwise;
  - `CarDeclined` is given `home` and `onContinueHome` when the tab's home journey is complete and quoted; otherwise "Get a home quote" navigates to `/quote/home?postcode=…` with no mark;
  - `CarReferred` gains `onContinueHome?` and shows `Continue with home only` when set;
  - either "home only" clears the mark and goes to `/quote/home?step=buy`;
  - both About you steps start from `prefillAbout(other journey)` when their own answers are empty.

- [ ] **Step 1: Write the failing component tests:**
  - "Add home insurance" with `E8 3RL` marks the bundle and navigates to `/quote/home` with the first home step;
  - with complete home answers it navigates with `step=cover`;
  - the holding line is gone;
  - screen 20 with a quoted home in the tab shows `Your home quote is still available`, and `Continue with home only` clears the mark;
  - screen 20 without one links to a home quote;
  - car's About you starts with home's name and date of birth, and home's starts with car's.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/quote src/features/quote/home`. Expected: FAIL.
- [ ] **Step 3: Implement.** Whether the home journey is quoted comes from `priceQuery("home", homeJourney)`, enabled only when `firstIncompleteHomeStep` is null.
- [ ] **Step 4: Run** the same command, plus all of `vp test --project component src/features/quote`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): add home from a car quote for real, and offer the other product when one can't be bought`

### Task 7: Home's outcomes in a bundle, and the gate saves the bundle

**Files:**
- Modify: `src/features/quote/HomeQuote.tsx`, `src/features/quote/HomeSteps.tsx`, `src/features/quote/BuyGate.tsx`, `src/features/quote/Outcomes.tsx` (03's car-only button), `src/features/quote/buy.browser.test.tsx`, `src/features/quote/bundle.browser.test.tsx`

**Interfaces:**
- **Consumes:** Task 3's `saveBundleQuoteFn` and its result; Task 1's `bundleLive` and `clearBundle`.
- **Produces:**
  - `HomeQuote` takes `bundle?: { car: CarOnly; onCarOnly: () => void }`. When home is declined it shows `HomeDeclinedBundle`; when referred, `HomeReferred` with `Continue with car only`;
  - `onCarOnly` clears the mark and navigates to `/quote/car?step=buy`. 03's `Send this for review` also clears the mark before saving the home quote alone;
  - `BuyStep` and `BuyGate` take `bundle?: { car: Journey }`. The gate then calls `saveBundleQuoteFn({ car: journeyToSave(car), home: journeyToSave(home) })`;
  - `saved` is set on the home journey with the key `savedQuoteKey(car) + ":" + savedQuoteKey(home)`;
  - the sign-up body is `{ product: "bundle", car, home }`;
  - `CoverWaiting` lists both items;
  - the save's answers:
    - `invalid` with `product: "car"` navigates to `/quote/car?step=…`; with `product: "home"` it's the home `invalid` move;
    - `mismatch` reopens home's About you with the message;
    - `not_quoted` goes to home's `quote` step, which shows 03 or 04.

- [ ] **Step 1: Write the failing component tests:**
  - home declined with a live bundle shows `Your car quote is still available` and the car's own total, and `Continue with car only` clears the mark;
  - home referred shows `Continue with car only`;
  - the gate with a live bundle calls `saveBundleQuoteFn` with both journeys (mocked), then moves to `/quote/pay/$quoteId`;
  - a `mismatch` answer reopens About you with `Your name and date of birth must match your car quote.`;
  - a stale mark makes the gate call `saveHomeQuoteFn`.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/buy src/features/quote/bundle`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run** the same command, plus all of `vp test --project component src/features/quote`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): the gate saves a bundle, and a home that can't be bought leaves the car buyable`

### Task 8: Confirm and pay, You're covered and Your saved quotes show a bundle

**Files:**
- Modify: `src/features/quote/PayPage.tsx`, `src/features/quote/CoveredPage.tsx`, `src/features/quote/SavedQuotes.tsx`, `pay.browser.test.tsx`, `saved-quotes.browser.test.tsx`, `buy.browser.test.tsx`

**Interfaces:**
- **Consumes:** Task 4's `PaymentSummary.items`, `bundleSavingPence`, `SavedQuoteCard.items` and `policyReferences`; `Purchase.policies` (already a list).
- **Produces:**
  - **Confirm and pay:** a "Your car" and a "Your home" card per item, then `Bundle saving` and the total. The overline is `Car + home insurance · Purchase` for a bundle;
  - **You're covered:** both policies (it already maps `policies`). The heading's product reads `car and home` for a bundle. Both journeys are cleared when the purchase has a car and a home policy;
  - **Your saved quotes:** one card per bundle reading `Car + home`, both items, the combined total and both references. "Continue" opens `/quote/pay/$quoteId`.

- [ ] **Step 1: Write the failing component tests:**
  - Confirm and pay with a two-item summary shows both cards and `Bundle saving`, and a one-item summary renders as before;
  - You're covered with two policies lists both references and clears both journeys (storage spy);
  - Your saved quotes with a bundle card shows `Car + home` and both references, and a car-only card is unchanged.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/pay src/features/quote/saved-quotes src/features/quote/buy`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `vp check` and `vp test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): confirm, pay for and see a car + home bundle`
- [ ] **Step 6: Checkpoint review** (Sonnet) on Tasks 5–8: the stale-mark paths, the car files' changes, and the old single-item views.

### Task 9: The bundle in Playwright, and the docs

**Files:**
- Create: `e2e/bundle-buy.spec.ts`
- Modify: `e2e/db.ts` (allow `delivered+e2e-bundle-…`), `plan/phases/05-quote/07b-bundle.md`, `phase.md`, `plan/build-plan.md`, `plan/figma.md`

- [ ] **Step 1: Write `e2e/bundle-buy.spec.ts`,** reusing `quote-journey.ts`'s car steps, `home-buy.spec.ts`'s home steps and `stripe.ts`. It runs at phone width.
  - **Car first:** the car journey → Choose cover → `Add home insurance` → the four home steps (About you already filled in) → Choose cover with `Together:` → `Continue to sign in` → sign up → Stripe `4242…` → You're covered with two references → both policies on `/account`. Axe runs on screen 22 and Confirm and pay.
  - **Home first:** the home journey → Choose cover → `Add car insurance` → the car steps (About you already filled in) → `Add home insurance` lands on home's Choose cover with the panel.
- [ ] **Step 2: Run it against local `vp dev`,** with `stripe listen` forwarding to `/api/webhooks/stripe`, and `E2E_DATABASE_URL` and `VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY` set: `pnpm exec playwright test e2e/bundle-buy.spec.ts`. Expected: PASS. Without the keys it must skip, not fail.
- [ ] **Step 3: Update the docs:**
  - the spec's Status and Done when;
  - `phase.md`'s 5.7b row;
  - `build-plan.md`'s box;
  - `figma.md`: screens 04, 21 and 22 built in 5.7b, with the saving shown, `Your car quote`, and home's own tiers.
- [ ] **Step 4: Run** `vp check` and `vp test`. Expected: PASS.
- [ ] **Step 5: Commit.** `test(e2e): buy car and home together with Stripe; docs: 5.7b in the plan`
- [ ] **Step 6: Whole-branch review** (Sonnet), then the PR per `git-workflow.md`, with Damion's preview check (the dev database needs no migration this time).
