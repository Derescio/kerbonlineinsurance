# 5.4 Rating engine: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `priceQuote()` prices car, home and business from the versioned rating tables, with eligibility per driver and the bundle discount. The car journey's holding view shows the Comprehensive price, or names the driver who stopped it. `saveQuote()` is built and tested for 5.6, and the seed moves onto both.

**Architecture:** There are four layers.
1. **The engine** in `src/features/rating/`: pure functions with no database access, taking a version's tables as data. Imported only by server code and tests, so the tables never reach the browser bundle.
2. **Loading:** `getRatingTables()` (4.8) gains the on-load check. `getActiveRatingVersion()` stays uncached.
3. **Server:** `priceCarJourney()` behind the `priceCar` server function, and `saveQuote()` with its row builder `quoteRows()`, shared with the seed.
4. **UI:** `QuoteHolding` fetches the price with React Query and shows the quoted, referred or declined state.

**Tech Stack:** TanStack Start 1.170 server functions, `@tanstack/react-query`, React 19, Zod 4, Drizzle on `pg` (`vp run db:generate` for the migration), Vitest `unit` / `integration` / `component` projects, Playwright with axe.

**Spec:** [04-rating-engine.md](04-rating-engine.md). Read decisions 1–15 before starting.

## Global Constraints

- **The engine's data type:** `RatingData = Readonly<Omit<RatingSource, "notes">>`. Both a `RatingSource` (4.8 source file) and a `RatingTables` (loaded, with `id`) satisfy it.
- **Rounding:** `Math.round` on a non-negative pence amount (half up), **once** per line: a tier's premium, an add-on's price, the bundle discount and each share of it, each item's IPT, each monthly figure. Factors multiply as plain floating-point numbers before that.
- **Order of a quoted item's money:** tier premium = `max(min_premium_pence, round(base × tier multiplier))` → minus its bundle share → plus selected add-ons → IPT on that sum → plus `fee_pence` (IPT isn't charged on the fee, which is 0 in every v1).
- **Monthly:**
  - **Stored** (`monthly_premium_pence`, `monthly_price_pence`, before IPT): `round(annual × (1 + monthly_credit_charge_rate) / 12)`, as the stand-in does.
  - **Shown:** `monthlyPayment(totalPence, rate) = round(totalPence × (1 + rate) / 12)`. £458.40 → `round(45840 × 1.10 / 12)` = 4202, "12 payments of £42.02".
- **Totals** come from **quoted** items only. A referred or declined item adds nothing and has no bundle share.
- **Bundle:** `bundle_discount_rate` (0.08) of the combined selected-tier premiums of the car and home items, when both are present and quoted. Business never bundles.
- **The selected tier** until 5.5: `comprehensive`. **Voluntary excess:** 0 from the journey.
- **The valuation year:** 2026 (4.8 call 7). Vehicle age = `max(0, 2026 − year)`.
- **Postcode area:** `/^[A-Z]{1,2}/` on the normalised postcode. `JE`, `GY`, `IM` (`CROWN_DEPENDENCIES`) decline with `outside_cover_area`, checked before any lookup, for every product.
- **Reason codes** (`reasonCodes` in `src/server/db/schema/values.ts`, in this order): `outside_cover_area`, `vehicle_value_too_high`, `young_driver_high_group`, `high_insurance_group`, `high_vehicle_value`, `past_claims`, `new_licence_high_group`, `driver_age`, `rebuild_cost_too_high`, `high_rebuild_cost`, `high_contents_value`, `old_property`, `high_turnover`, `many_employees`, `high_risk_employees`, `premium_above_max`.
- **Price rate limit:** key `quote.price:${subject}`, `{ max: 60, windowSeconds: 3600 }`.
- **Saved quotes:** reference `KRB-Q-` + a random integer 10000–89999, up to 5 tries on a unique clash; `valid_until` = now + 30 days; `status: "draft"`.
- **Copy** (curly apostrophe, `&rsquo;` in JSX):
  - **Loading:** `Working out your price…`
  - **Quoted:** heading `Your Comprehensive price`; `£{annual} a year, or 12 payments of £{monthly}`; note `Premiums include Insurance Premium Tax.`
  - **Referred:** `We need to check a couple of things, usually within a day.`
  - **Declined:** `We can’t offer car cover for these details.`
  - **A named driver referred:** `We need to check a couple of things about {firstName}.` **Declined:** `We can’t offer cover with {firstName} as a named driver.` Then a button `Remove {firstName} to see a price without them`.
  - **Failure:** `We couldn’t work out your price just now.` with `Try again`. **Rate-limited:** `You’ve asked for a lot of prices in a short time. Try again in an hour.`
  - Money as `£1,234.56` (`en-GB`, two decimals).

## Review Focus

1. **A visitor edits a step so it no longer passes, then returns to the summary.** The price must not be fetched for answers that fail; the server answers `invalid` with the first failing step, and the view sends them there. Test in Task 6 (server) and Task 8 (UI).
2. **A named driver with `anyClaims: false` but a stale `pastClaims` number** left in the tab from an earlier answer. Their claims must count as 0. Test in Task 5.
3. **Two named drivers both trip a rule.** The first one entered is the one named. Test in Task 2.
4. **The car is removed from the catalogue or made inactive** after the visitor chose it (an old tab). The server answers `invalid` with step `car`, not a 500. Test in Task 6.
5. **A bundle where one item's premium is exactly the minimum** and the discount takes it below. Allowed (spec decision 7): the discounted premium is below the minimum and IPT is on the discounted figure. Test in Task 3.

---

### Task 1: Rating tables helper, money and the car, home and business raters

**Files:**
- Create `src/features/rating/types.ts`, `tables.ts`, `money.ts`, `rate.ts`, `money.test.ts`, `rate.test.ts`, `test-tables.ts` (a small hand-made `RatingData` per product for arithmetic tests).

**Interfaces:**
- **Produces:**
  - `types.ts`:
    - `CarDriver = { age: number; licenceYears: number }`
    - `CarInputs = { vehicle: { year: number; insuranceGroup: number; fuelType: string; valuePence: number }; driver: CarDriver & { occupation: string; noClaimsYears: number }; namedDrivers: CarDriver[]; pastClaims: number; postcodeArea: string; annualMileage: number; usage: string; overnightLocation: string; voluntaryExcessPence: number }`
    - `HomeInputs` and `BusinessInputs`: the stand-in's (`scripts/seed/pricer.ts`) without `coverLevel`, and without `addons` for business.
    - `RatingInputs = { product: "car"; inputs: CarInputs } | { product: "home"; inputs: HomeInputs } | { product: "business"; inputs: BusinessInputs }`
    - `PricedFactor`, `PricedOption`, `PricedAddon`: as the stand-in's.
    - `Rated = { base: number; factors: PricedFactor[]; extraExcessPence: number; addons: PricedAddon[] }` (the stand-in's minus `eligibility`).
  - `tables.ts`: `class Tables { constructor(data: RatingData); param(name): number; range(factor, value): PricedFactor; choice(factor, band): PricedFactor; lookup(kind, factor, key, label) }`, each throwing as the stand-in does.
  - `money.ts`: `ipt(pence, rate)`, `storedMonthly(annualPence, rate)`, `monthlyPayment(totalPence, rate)`, `formatPounds(pence): string`.
  - `rate.ts`: `rateCar(t, i: CarInputs): Rated`, `rateHome(t, i: HomeInputs): Rated`, `rateBusiness(t, i: BusinessInputs): Rated`, `priceOptions(t, rated): PricedOption[]` (all three tiers).
- **Rules beyond the stand-in:** `rateCar` adds one `named_driver_age` factor for the **youngest** named driver, and none when there are none. `extraExcessPence` is `young_driver_excess_pence` when **any** driver is under 25.

- [ ] **Step 1: Write the failing tests.** Every expected value has its working in a comment, from `test-tables.ts`'s numbers or v1's, never from the code's output.
  - `money.test.ts`: `monthlyPayment(45840, 0.1)` is `4202`; `storedMonthly(63000, 0.1)` is `5775`; `ipt(30666, 0.12)` is `3680`; `formatPounds(123456)` is `£1,234.56`.
  - `rate.test.ts`, with `test-tables.ts`:
    - **Rounding once:** base 1001 and three factors of 1.15 give a tier premium of `1522` (1001 × 1.520875 = 1522.39), not the 1523 that rounding each step gives.
    - **Minimum:** a risk worth less than `min_premium_pence` is raised to it on every tier.
    - **Named drivers:** with drivers aged 40 and 19, the only `named_driver_age` row is the 19-year-old's band; with none, no row.
    - **Young-driver excess:** main 30 and named 22 adds it to every tier's compulsory excess; main 30 and named 25 doesn't.
    - **Config errors throw:** an unknown occupation, a missing parameter and a value with no band each throw, naming the product.
    - **Each factor once:** car, home and business each record every factor at most once.
- [ ] **Step 2: Run them and see them fail.** `vp test --project unit src/features/rating` fails.
- [ ] **Step 3: Implement** by moving the stand-in's `Tables`, `rateCar`, `rateHome`, `rateBusiness`, `flatAddons` and the option loop into these files with the new input shape. Leave `scripts/seed/pricer.ts` alone until Task 7.
- [ ] **Step 4: Run them and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(rating): the rating tables helper, money rounding and the car, home and business raters`.

### Task 2: Eligibility, reason codes and the migration

**Files:**
- Create `src/features/rating/eligibility.ts`, `eligibility.test.ts`; a migration from `vp run db:generate`.
- Modify `src/server/db/schema/values.ts` (`reasonCodes`, `ReasonCode`), `quotes.ts` (`quote_items_reason_code_values_check`) and `underwriting.ts` (`underwriting_decisions_reason_code_values_check`).

**Interfaces:**
- **Produces:**
  - `Eligibility = { outcome: "referred" | "declined"; reason: ReasonCode; driver: "main" | number | null } | null`. A number is the named driver's 1-based position; `null` means the rule isn't about a driver.
  - `carEligibility(t, i: CarInputs): Eligibility`, `homeEligibility(t, i: HomeInputs)`, `businessEligibility(t, i: BusinessInputs)`, and `coverAreaEligibility(postcodeArea): Eligibility` (the Crown dependencies).
- **Car order** (the first hit wins): value decline → young-driver declines for main, then each named driver in order → group referral → value referral → past claims (the total) → new-licence referral per driver → age referral per driver. Thresholds are the stand-in's parameters.
- **The check constraints** allow `null` or one of `reasonCodes`.

- [ ] **Step 1: Write the failing tests** in `eligibility.test.ts`, against v1's car, home and business sources:
  - **Boundaries:** for every rule, one below, on and one above its parameter. For example, under 21 on group 30 is declined, on group 29 it isn't, and at 21 on group 30 it isn't.
  - **Named drivers:** a 19-year-old named driver on group 32 is `{ declined, young_driver_high_group, driver: 1 }`. With named drivers aged 30 and 19, the result is `driver: 2`. With two 19-year-olds, `driver: 1` (Review Focus 3). A named driver's decline beats the main driver's referral at 80.
  - **Every product:** `coverAreaEligibility("JE")` declines with `outside_cover_area`, and `"LS"` returns `null`.
  - **No sensitive fields:** a type-level test (`expectTypeOf<keyof CarInputs["driver"]>()`, and the same for named drivers, home and business) shows that none of `sex`, `gender`, `ethnicity`, `religion`, `health`, `disability` or `nationality` is a key.
- [ ] **Step 2: Run them and see them fail.** `vp test --project unit src/features/rating/eligibility.test.ts` fails.
- [ ] **Step 3: Implement** the functions, add `reasonCodes` and the two checks, then run `vp run db:generate`. Check that the generated SQL only adds the two `CHECK`s.
- [ ] **Step 4: Run them and see them pass.** The same command passes. Then run `vp run db:test:up` and `vp test --project integration src/server/db`; `constraints.int.test.ts` gains one case each: a reason code outside the list is refused.
- [ ] **Step 5: Commit** with `feat(rating): eligibility per driver, the reason-code list and its checks`.

### Task 3: `priceQuote()`, the bundle and calibration

**Files:**
- Create `src/features/rating/price-quote.ts`, `price-quote.test.ts`, `calibration.test.ts`.

**Interfaces:**
- **Consumes:** Tasks 1 and 2.
- **Produces:**
  - `QuoteItemRequest = RatingInputs & { tables: RatingData; coverLevel: CoverLevel; addons: string[] }`
  - `PricedItem = { product; ratingVersionId: string | null; outcome; reasonCode: ReasonCode | null; driver: "main" | number | null; factors; options: PricedOption[]; addons: PricedAddon[]; selected: { coverLevel; premiumPence; addonsPence; discountPence; iptPence; feePence; totalPence } | null }`. `selected` is `null` unless the item is quoted. `ratingVersionId` is the tables' `id`, or `null` for a source.
  - `PricedQuote = { items: PricedItem[]; subtotalPence; bundleDiscountPence; feesPence; iptPence; totalPence; monthlyCreditChargeRate: number }`. `subtotal` is the sum of the selected premiums and add-ons before the discount, so the 4.2 check `total = subtotal − discount + fees + ipt` holds.
  - `priceQuote(items: QuoteItemRequest[]): PricedQuote`. It throws on two items of one product.
  - `splitBundleDiscount(premiums: { product; premiumPence }[], rate): Map<product, number>`. The discount is `round(rate × sum)`. Each smaller item's share is `round(discount × premium / sum)`, and the largest takes what's left.
- **Above the maximum:** a selected tier above `max_premium_pence` makes the item `referred` with `premium_above_max` (after eligibility found nothing).

- [ ] **Step 1: Write the failing tests.** Each has its hand working in a comment.
  - **The bundle split:**
    - **Even shares:** car 60000 and home 30000 give a discount of 7200, split car 4800 and home 2400.
    - **The leftover penny:** car 33333 and home 16667 give a discount of 4000. Home gets `round(1333.36)` = 1333, and car gets 4000 − 1333 = 2667.
  - **IPT after the discount:** for the same pair, car IPT is `round(30666 × 0.12)` = 3680 and home `round(15334 × 0.12)` = 1840.
  - **The breakdown sums:** for car alone, home alone, business alone and car + home, `subtotal − discount + fees + ipt === total`, and the items' `selected.totalPence` sum to `totalPence`.
  - **No bundle:**
    - **Not both quoted:** car quoted with home referred, and car referred with home quoted, each give a discount of 0. The referred item's `selected` is `null`.
    - **A lone product:** car alone, and business with home, each give 0.
  - **Below the minimum** (Review Focus 5): home at exactly `min_premium_pence` in a bundle has a premium below the minimum after its share, with IPT on the discounted figure.
  - **Above the maximum:** a selected tier above the maximum is referred with `premium_above_max`, and another tier choice that fits stays quoted.
  - **Duplicates:** two car items throw.
  - **Calibration** (`calibration.test.ts`): for each of `CALIBRATION_PEOPLE`, a test adapter maps the person's inputs to `RatingInputs`. For a car person, `driver.pastClaims` becomes `pastClaims`, and `namedDriver` becomes `namedDrivers: [{ age, licenceYears: age − 17 }]`. Price it against its v1 source at its `coverLevel`. For a quoted person, the annual total including IPT is within `[minPence, maxPence]` and within 1p of `handPence` (the hand calculation rounds once at the end too; a larger gap is a finding to report, not a code change). For the others, the outcome and reason match. A miss means a v2, never a v1 edit (spec decision 12): stop and report it.
- [ ] **Step 2: Run them and see them fail.** `vp test --project unit src/features/rating` fails.
- [ ] **Step 3: Implement** `priceQuote` and `splitBundleDiscount`.
- [ ] **Step 4: Run them and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(rating): priceQuote() with the bundle discount, totals that sum, and the ten calibration people`.

### Task 4: The rating config checked on load

**Files:**
- Modify `src/server/data/reference.ts` (`loadRatingTables`), and its integration test (`reference.int.test.ts`, or the file that covers `getRatingTables`).

**Interfaces:**
- **Produces:** `getRatingTables(db, id)` throws `Rating version ${id} failed its check: …`, listing `validateRatingSource()`'s problems, before memoising. The failed promise is dropped from the cache, as it already is for a load failure.

- [ ] **Step 1: Write the failing integration tests.**
  - **Bad versions:** insert a version with a missing parameter, a multiplier of 0, a negative multiplier, a factor name the product's raters don't read, and a gap between two range bands. Each makes `getRatingTables` reject.
  - **An unknown id** rejects with `not found`.
  - **The v1 versions** still load.

  If `validateRatingSource()` doesn't catch one of these, add the check there and a unit case to `validate.test.ts`.
- [ ] **Step 2: Run them and see them fail.** `vp test --project integration src/server/data` fails.
- [ ] **Step 3: Implement** by calling `validateRatingSource({ ...loaded, notes: "loaded" })` inside `loadRatingTables`.
- [ ] **Step 4: Run them and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(rating): a rating version is checked when it's loaded, and refused if it fails`.

### Task 5: From the car journey to rating inputs

**Files:**
- Create `src/features/rating/car-journey.ts`, `car-journey.test.ts`.

**Interfaces:**
- **Consumes:** `Journey` (`src/features/quote/journey-store.ts`), `ageOn`, `wholeYearsBetween` (`schemas/dates.ts`).
- **Produces:** `carInputsFromJourney(journey: Journey, car: { year; insuranceGroup; fuelType; valuePence }, today: string): CarInputs`.
  - **Preconditions:** every 5.3 step passes (the caller checks). It throws on a missing part.
  - **Fields:**
    - `driver.age` comes from `ageOn(dateOfBirth, today)`, and `licenceYears` from `wholeYearsBetween(licenceDate, today)`.
    - `pastClaims` = the main driver's incident count, plus, for each named driver, `pastClaims` when `anyClaims`, else 0.
    - `postcodeArea` comes from the journey postcode, and `voluntaryExcessPence` is 0.

- [ ] **Step 1: Write the failing tests.**
  - **Ages:** a date of birth of 2007-11-12 is 19 on `today = "2026-11-12"` and 18 on `"2026-11-11"`.
  - **Licence years:** whole years.
  - **Past claims:** two incidents and a named driver with 1 claim give `pastClaims: 3`. A named driver with `anyClaims: false` and a stale `pastClaims: 4` adds 0 (Review Focus 2).
  - **Named drivers:** come in entry order.
  - **Postcode area:** `"SW1A 1AA"` gives `"SW"`.
- [ ] **Step 2: Run them and see them fail.** `vp test --project unit src/features/rating/car-journey.test.ts` fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** with `feat(rating): the car journey's answers as rating inputs`.

### Task 6: The price on the server

**Files:**
- Create `src/server/quote/price.ts`, `price.int.test.ts`.
- Modify `src/features/quote/server.ts` (adds `priceCar`).

**Interfaces:**
- **Consumes:** Tasks 3 and 5, `stepState` / `firstIncompleteStep`, `postcodeSchema`, `getCatalogue`, `getActiveRatingVersion`, `getRatingTables`, `limit`, `rateLimitSubject`, `todayIso`.
- **Produces:**
  - `CarPriceResult`:
    - `{ status: "quoted"; annualPence: number; monthlyPaymentPence: number }`
    - `{ status: "referred" | "declined"; namedDriver: number | null }`
    - `{ status: "invalid"; step: "car" | DriverStep }`
    - `{ status: "rate_limited" }`
  - `priceCarJourney(raw: unknown, headers: Headers, now = new Date()): Promise<CarPriceResult>`.
    - **Order:** limit first.
    - **Input:** `raw` is a journey's `postcode`, `vehicle`, `mainDriver`, `usage`, `claims` and `namedDrivers`, read with `journey-store`'s part schemas.
    - **Invalid:** a car that isn't in `getCatalogue()` → `invalid` with `car`. A failing step → `invalid` with that step.
    - **Pricing:** only Comprehensive with no add-ons. `annualPence` is that item's `selected.totalPence`, and `monthlyPaymentPence` is `monthlyPayment(annualPence, rate)`.
    - **The reason code** isn't sent; only the named driver's position is.
    - **No logging:** the input is never logged.
  - `priceCar` server function: POST, `publicMiddleware`, and the validator passes `unknown` through.

- [ ] **Step 1: Write the failing integration tests**, against the test database with v1 and the catalogue loaded:
  - **A full journey** (built from `journey-fixtures.ts`) on the Golf returns `quoted`. The total matches a hand calculation from v1 in a comment, and the JSON has no key from `RatingData` (`factors`, `parameters`, `tiers`, `lookups`).
  - **The Tesla** (`TS24 EIV`'s catalogue row, group 32) with a 19-year-old named driver returns `{ declined, namedDriver: 1 }`. Without them it returns `quoted`.
  - **A broken step:** a licence date before the 17th birthday returns `invalid`, `driving` (Review Focus 1).
  - **An unknown or inactive car** returns `invalid`, `car` (Review Focus 4).
  - **The limit:** the 61st call in an hour from one IP returns `rate_limited`.
- [ ] **Step 2: Run them and see them fail.** `vp test --project integration src/server/quote/price.int.test.ts` fails.
- [ ] **Step 3: Implement** `priceCarJourney`, and add `priceCar` to `server.ts` with the server module imported inside the handler, as `startQuote` does.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** with `feat(quote): the car price worked out on the server, rate-limited, never sending the tables`.

### Task 7: `saveQuote()` and the seed on the real engine

**Files:**
- Create `src/server/quote/quote-rows.ts`, `src/server/quote/save.ts`, `save.int.test.ts`.
- Modify `scripts/seed/builders.ts`, `generate.ts` and its tests.
- Delete `scripts/seed/pricer.ts` and `pricer.test.ts`.

**Interfaces:**
- **Consumes:** Task 3's `PricedQuote` and `PricedItem`.
- **Produces:**
  - `quoteRows(priced: PricedQuote, ctx: { quoteId; reference; customerId; postcode; at: Date; validUntil: Date; items: { startDate: string; voluntaryExcessPence: number; details: ItemDetails }[]; newId: () => string }): QuoteRowSet`. The rows are typed as each table's insert type: `quotes`, `quoteItems`, `quoteItemOptions`, `quoteItemAddons`, `quoteItemFactors`, `underwritingDecisions`, `vehicles`, `drivers`, `properties`, `businesses`.
    - **The selected option:** `selectedOptionId` is the selected tier's option, or `null` when declined.
    - **The decision note:** an `underwriting_decisions` row has `note: "named driver {n}"` when `driver` is a number, and `null` otherwise.
  - `ItemDetails`: a car's vehicle snapshot and drivers (main first), a home's property, a business's business, as each table takes them.
  - `saveQuote(db, input: { customerId; postcode; priced: PricedQuote; items: …; now?: Date }): Promise<{ quoteId: string; reference: string }>`. It writes every row in one transaction, drawing the reference per Global Constraints.
  - **The seed:**
    - **Pricing:** the seed builds `QuoteItemRequest`s and calls `priceQuote` and `quoteRows`.
    - **References:** it keeps its own 9-range numbering and its `quote.priced` / `quote.referred` / `quote.declined` events.

- [ ] **Step 1: Write the failing integration tests** in `save.int.test.ts`, with a customer from `src/test/factories.ts`:
  - **A car and home bundle:**
    - **The quote row:** its totals equal the `PricedQuote`'s.
    - **The children:** each item has 3 options, its add-ons and factor lines, the `rating_version_id`, and one decision row.
    - **The car's detail rows:** the vehicle snapshot and drivers with `is_main`.
  - **The decision note:** a named-driver decline writes `note = 'named driver 1'`.
  - **A failed save:** a failure part-way (a bad `details` that breaks a check) leaves no rows.
  - **An old price stays:** after saving, a car v2 is inserted and made active. Reading the saved item's options returns the original prices, and its `rating_version_id` is still v1's.
  - **The reference** matches `^KRB-Q-[1-8][0-9]{4}$`.
- [ ] **Step 2: Run them and see them fail.** `vp test --project integration src/server/quote/save.int.test.ts` fails.
- [ ] **Step 3: Implement** `quoteRows` and `saveQuote`. Move the seed onto them, then delete the stand-in.
- [ ] **Step 4: Run them and see them pass.** Then run `vp test --project unit scripts/seed` and `vp test --project integration scripts/seed`. The seed's own tests still pass, with their expected counts unchanged.
- [ ] **Step 5: Commit** with `feat(quote): saveQuote() for 5.6, and the seed priced by priceQuote()`.

### Task 8: The price on the holding view

**Files:**
- Create `src/features/quote/price-query.ts`, `QuotePrice.tsx`.
- Modify `QuoteHolding.tsx`, `DriverSteps.tsx` and `drivers.browser.test.tsx`.

**Interfaces:**
- **Consumes:** Task 6's `priceCar` and `CarPriceResult`.
- **Produces:**
  - `usePriceQuery(journey)`: a `useQuery`.
    - **Key:** `["quote-price", <the six parts>]`, so an edit re-prices.
    - **Settings:** `retry: false` and `staleTime: Infinity`.
  - `QuotePrice({ journey, onEdit })` shows each state with the Global Constraints copy.
    - **A named driver:** `namedDriver` names `journey.namedDrivers.drivers[n − 1].firstName`, and its button calls `onEdit("drivers")`.
    - **`invalid`:** calls `onEdit(step)`. `"car"` goes back to the car step.
    - **Its place:** the slot that "Your price arrives in 5.4" held, above the summary rows.

- [ ] **Step 1: Write the failing component tests**, with `priceCar` mocked at the module boundary:
  - **Quoted:** `{ quoted, 45840, 4202 }` shows `£458.40 a year, or 12 payments of £42.02`.
  - **A named driver referred:** shows `We need to check a couple of things about Sam.`, with no price.
  - **A named driver declined:** `Remove Sam to see a price without them` calls `onEdit("drivers")`.
  - **Removing them:** removing the driver and continuing back to the summary fetches again, and the new price shows.
  - **Invalid:** `{ invalid, "driving" }` calls `onEdit("driving")`.
  - **Rate-limited:** shows its copy.
  - **A failure:** shows `Try again`, which fetches again.
  - **The URL:** no price or name appears in it.
- [ ] **Step 2: Run them and see them fail.** `vp test --project component src/features/quote/drivers.browser.test.tsx` fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Run `vp test --project component src/features/quote`, and the 5.2 and 5.3 files still pass.
- [ ] **Step 5: Commit** with `feat(quote): the holding view shows the car price, or names the driver who stopped it`.

### Task 9: E2E, axe, docs and the full check

**Files:**
- Modify `e2e/drivers.spec.ts`, `plan/figma.md`, `plan/phases/05-quote/04-rating-engine.md`, `phase.md` and `plan/build-plan.md`.

- [ ] **Step 1: Extend the E2E.**
  - **The Golf:** the driver-steps journey on `VW21 GQL` ends on `Your Comprehensive price` with a `£` figure.
  - **The Tesla:** a second journey on `TS24 EIV` with a 19-year-old named driver shows the decline naming them. `Remove …` → remove → continue shows a price.
  - **Axe:** on the holding view at 390 and 1440 px.
- [ ] **Step 2: Run the whole check.** Stop `vp dev` first. `vp check`, `vp test` (with `vp run db:test:up`), `vp build`, and the E2E on a local preview all pass.
- [ ] **Step 3: Write the docs.**
  - **`figma.md`:** screen 13's row notes that its monthly figures and footnote are out of date; the monthly price is 10% more (5.4, decision 1).
  - **The spec:** Status is "done (PR pending; manual check on staging and the dev reseed still to record)", with the local results under Done when.
  - **`phase.md` and `build-plan.md`:** 5.4 is marked done.
- [ ] **Step 4: Commit** with `test(quote): the priced journey end to end with axe; docs for 5.4`.
- [ ] **After the merge (Damion runs or approves):** reseed `dev` with `vp run db:reset-dev` and `vp run db:seed`, then record the counts and a spot check of a few seeded prices in the spec's manual check.
