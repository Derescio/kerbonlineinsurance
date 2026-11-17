# 5.7 Home steps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/quote/home` becomes a home quote you can buy: About you → Property → Contents → Claims → Your quote → Choose cover → the gate → Stripe → You're covered. Every answer is stored.

**Architecture:**
- **Home gets its own step layer beside car's.** That's schemas, step state, the step router, four step components and a "Your quote" view.
- **The shared screens learn a `product`:** Choose cover, the gate, Confirm and pay, You're covered and Your saved quotes. The price hooks, the journey-store setters and the summaries the server reads do too.
- **On the server:**
  - `checkHomeJourney` → `priceHome` / `saveHomeQuoteFor`, mirroring car's `car-check.ts`, `price.ts` and `save.ts`;
  - `itemRows` writes `prior_claims` rows beside `properties`;
  - one additive migration.

**Tech Stack:** TanStack Start (server functions, file routes), React, TanStack Query, Zod 4, Drizzle on Postgres, Vitest (projects `unit`, `integration`, `component`), Playwright.

**Spec:** [07-home-steps.md](07-home-steps.md). Read all 12 decisions first. Car's equivalents are named in each task; read them before writing the home version.

## Global Constraints

- **Car must not change behaviour.** Every existing car test passes. Edits to car files only add a `product` parameter (defaulting where a caller is car-only) or rename a shared type.
- **Answers that change with the date** (age, the 5-year claim window) are checked against `todayIso()`, and step state re-runs the schemas on stored answers, as `steps.ts` does.
- **Copy, exactly as the spec gives it.** Headings:
  - `Tell us about you`;
  - `Tell us about your property`;
  - `Your contents and home security`;
  - `Any home claims in the last 5 years?`

  Buttons: `Continue to property`, `Continue to contents`, `Continue to past claims`, `Get my home quote`.
- **New error messages**, in `schemas/home-steps.ts`'s `homeErrors`:
  - `You must be 18 or over to get a home quote.`
  - `Valuables are part of your contents, so they can’t be more than the contents total.`
  - `Enter a rebuild cost between £50,000 and £5,000,000.`
  - `Enter a contents value between £5,000 and £500,000.`
  - `Enter a year between 1500 and {this year}.`
  - `Choose the number of bedrooms.`
  - `Choose the property type.`
  - `Choose the main door lock.`
  - `Choose the window locks.`
  - `Choose the burglar alarm.`
  - `Choose the type of claim.`
  - `Choose the claim status.`
  - `Enter the amount in whole pounds.`
  - `You can add up to 5 claims.`
  - `Add the claim, or answer no.`
  - `Remove the claims, or answer yes.`
  - `Confirm your details to continue.`
  - `Choose your address, or enter it manually.`

  Everything else reuses car's `errors` (names, address lines, dates, the 5-year window).
- **Stored values:**
  - `propertyTypes` (existing);
  - `lockTypes` (existing);
  - `windowLockTypes = ["all_accessible", "some", "none"]`;
  - `alarmTypes = ["none", "installed_unmonitored", "monitored"]`;
  - `homeClaimTypes = ["escape_of_water", "theft", "accidental_damage", "storm_flood", "fire", "subsidence", "other"]`;
  - `priorClaimStatuses = ["settled", "open", "withdrawn"]`.
- **Money is entered in whole pounds and stored in pence.**
- **Commits:** each ends with both trailers:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name. Never stop `vp dev` to run tests; check port 3000 is free before component tests or a build.

## Review Focus

1. **A home journey started before a deploy, or with a part that no longer parses** (an old tab). Each part is dropped alone, and the visitor lands on that step, never on a crash. *Test in Task 3.*
2. **A claim that leaves the 5-year window overnight** reopens Claims with its error, and the server's price says `invalid: claims`. *Tests in Tasks 3 and 6.*
3. **Changing the postcode on Property after picking an address.** The picked address is cleared (it belongs to the old postcode), the journey's postcode and URL change, and the price uses the new area. *Test in Task 9.*
4. **A home sign-up from the gate** saves a **home** quote, not a car one. The sign-up body carries the product. *Test in Task 6.*
5. **Your saved quotes and You're covered with a home quote, and with a car quote,** after the summaries gain `home`: both render, and an old car quote still shows its car. *Test in Task 7.*

---

### Task 1: Shared field helpers and the home step schemas

**Files:**
- Create: `src/features/quote/schemas/fields.ts`, `src/features/quote/schemas/home-steps.ts`, `src/features/quote/schemas/home-steps.test.ts`
- Modify: `src/features/quote/schemas/driver-steps.ts` (import the helpers instead of defining them)

**Interfaces:**
- Produces, from `fields.ts`: `ISO`, `isoDate(message)`, `text(required, max, tooLong)`, `whole(message, min, max, tooBig)`, `choice(options, message)`, `values(options)`, `option(value, label)`, `yesNo`, and `dateOfBirth(today, tooYoung, minAge = 17)`. These are moved from `driver-steps.ts` unchanged, except that `dateOfBirth` gains `minAge`.
- Produces, from `home-steps.ts`:
  - **Options:** `propertyTypeOptions`, `lockTypeOptions`, `windowLockOptions`, `alarmOptions`, `homeClaimTypeOptions`, `claimStatusOptions` (`{ value, label }[]`, labels as in the spec).
  - **Schemas:** `homeAboutSchema(today)` → `{ firstName, lastName, dateOfBirth }`; `propertySchema(thisYear)` → `{ address: { line1, line2?, town, picked: boolean }, propertyType, yearBuilt, bedrooms, rebuildCostPounds }`; `contentsSchema` → `{ contentsValuePounds, valuablesPounds, lockType, windowLocks, alarm, smokeAlarm: boolean }`; `homeClaimsSchema(today)` → `{ any, claims: { id, date, type, amountPounds, status }[], confirmed: true }`.
  - **Types:** `HomeAbout`, `PropertyAnswers`, `ContentsAnswers`, `HomeClaims`, `HomeClaim`; `homeErrors`.

- [ ] **Step 1: Write the failing tests** in `home-steps.test.ts`, with `today = "2026-11-16"`:
  - `homeAboutSchema` refuses a 17-year-old (`dateOfBirth: "2009-11-17"`) with `You must be 18 or over to get a home quote.` and accepts `"2008-11-16"`.
  - `propertySchema(2026)` accepts the rebuild limits `50000` and `5000000` and refuses `49999` and `5000001`; accepts year built `1500` and `2026` and refuses `1499` and `2027`; accepts bedrooms `0` and `10` and refuses `11`. With no `address` it gives `Choose your address, or enter it manually.`
  - `contentsSchema` accepts contents `5000` and `500000`, refuses `4999`. It refuses valuables `5001` with contents `5000`, with the valuables message on `["valuablesPounds"]`.
  - `homeClaimsSchema`:
    - refuses `any: true` with no claims, and 6 claims;
    - refuses a claim dated `"2021-11-15"` (more than 5 years before today) and one dated `"2026-11-17"` (in the future);
    - refuses `any: false` with claims;
    - refuses `confirmed: false`;
    - accepts the amounts `0` and `1000000`.
  - **Amounts with commas** (`"250,000"`) parse to numbers.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/schemas`. Expected: home-steps fails (module not found), and `driver-steps.test.ts` passes.
- [ ] **Step 3: Move the helpers into `fields.ts`,** and import them in `driver-steps.ts`. Then write `home-steps.ts`:
  - `alarm` uses `alarmTypes`, and `windowLocks` uses `windowLockTypes`.
  - Claim dates reuse car's `incidentOld` and `incidentFuture` messages.
  - `address.picked` says whether it came from the list. Manual entry is `picked: false`.
- [ ] **Step 4: Run** `vp test --project unit src/features/quote`. Expected: all pass, including every car schema test.
- [ ] **Step 5: Commit.** `feat(quote): home step schemas, with the field helpers shared with car`

### Task 2: Demo addresses and the address lookup

**Files:**
- Create: `src/features/quote/demo-addresses.ts`, `src/features/quote/demo-addresses.test.ts`, `src/server/quote/addresses.ts`, `src/server/quote/addresses.int.test.ts`
- Modify: `src/server/data/postcode-rows.ts` (add `findPostcodeTown`), `src/features/quote/server.ts` (add `findAddresses`)

**Interfaces:**
- Produces:
  - `interface DemoAddress { id: string; line1: string; line2?: string; town: string }`
  - `demoAddresses(postcode: string, town: string): DemoAddress[]`: pure, 8 to 12 entries, with ids stable per postcode.
  - `findPostcodeTown(postcode: string, db?): Promise<string | null>` reads `postcode_areas.admin_district`.
  - `findAddressesFn({ postcode }) → { result: PostcodeCheck; addresses: DemoAddress[] }` (exported from `server.ts` as `findAddresses`). It uses `publicMiddleware` and calls `checkPostcodeExists`, which applies its rate limit and stores the area. Then it lists addresses with town = admin district, or else the outcode. On `not_found` or `unavailable`, `addresses` is `[]`.

- [ ] **Step 1: Write the failing unit tests.**
  - `demoAddresses("E8 3RL", "Hackney")` called twice gives equal lists.
  - `"E8 3RL"` and `"M1 1AE"` give different first lines.
  - The length is between 8 and 12.
  - Every entry has a non-empty `line1`, and `town === "Hackney"`.
  - At least one entry has a `line1` starting `Flat `.
- [ ] **Step 2: Write the failing integration test,** with postcodes.io mocked as in `postcode.int.test.ts`:
  - a known postcode returns `found`, with addresses whose town is the mocked `admin_district`;
  - an unknown postcode returns `not_found` and `[]`.
- [ ] **Step 3: Implement.** Use a fixed list of about 30 UK street names. Pick the street from an FNV-1a hash of the normalised postcode (the same hash style as `savedQuoteKey`), and derive the house numbers from it.
- [ ] **Step 4: Run** `vp test --project unit src/features/quote/demo-addresses.test.ts`, then `vp test --project integration src/server/quote/addresses.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): demo addresses for a postcode, behind a lookup that checks it with postcodes.io`

### Task 3: The home journey in the tab, and its step state

**Files:**
- Modify: `src/features/quote/journey-store.ts`, `src/features/quote/journey-store.test.ts`
- Create: `src/features/quote/home-steps.ts`, `src/features/quote/home-steps.test.ts`
- Modify (callers of the setters): `DriverSteps.tsx`, `QuotePrice.tsx`, `BuyGate.tsx` (pass `"car"`)

**Interfaces:**
- **Consumes:** Task 1's types.
- **Produces, in `journey-store.ts`:**
  - `Journey` gains `homeAbout?: HomeAbout`, `property?: StoredProperty`, `contents?: ContentsAnswers` and `homeClaims?: HomeClaims`. `StoredProperty` is `PropertyAnswers` with `rebuildCostPounds` and the others as numbers.
  - Their stored shapes go in `partSchemas`, checking types and stored values only, like car's.
  - `setCover(product, cover)`, `setSaved(product, saved)`. `setPayment` already takes the product.
  - `setHomeStepAnswers<S extends keyof HomeStepAnswers>(step, answers)` with `HomeStepAnswers = { about: HomeAbout; property: PropertyAnswers; contents: ContentsAnswers; claims: HomeClaims }`.
  - `setHomePostcode(postcode)` sets `postcode` and drops a `picked` address.
- **Produces, in `home-steps.ts`:**
  - `HOME_STEPS = ["about", "property", "contents", "claims"] as const` and `type HomeStep`;
  - `storedHomeAnswers(journey, step)`, `storedHomeErrors(journey, step, today)`, `homeStepState(journey, today)`;
  - `firstIncompleteHomeStep(journey, today): HomeStep | null`;
  - `homeTabStates(journey, current, today): Record<HomeStep, TabState>`.

  They mirror `steps.ts`, but home has no car step.

- [ ] **Step 1: Write the failing tests.**
  - `journey-store.test.ts`:
    - home parts round-trip through `readJourney("home")`;
    - a `property` with a string `yearBuilt` is dropped and `homeAbout` survives;
    - `setCover("home", …)` doesn't touch the car journey;
    - `setHomePostcode` drops a picked address and keeps a manual one.
  - `home-steps.test.ts`:
    - an empty journey has `about` first;
    - a journey complete to `contents` has `claims` first;
    - tabs after the first unfinished step are `locked`;
    - a journey whose only claim is dated `"2021-11-17"` is complete on `"2026-11-16"` and stops at `claims` on `"2026-11-18"`.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote`. Expected: the new tests fail.
- [ ] **Step 3: Implement it, and update the car callers** to `setCover("car", …)` and `setSaved("car", …)`.
- [ ] **Step 4: Run** `vp test --project unit src/features/quote`, then `vp check`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): the home journey's answers in the tab, and which home steps are done`

### Task 4: The migration: new `properties` columns and `prior_claims`

**Files:**
- Modify: `src/server/db/schema/values.ts`, `src/server/db/schema/products.ts`, `src/server/db/schema/relations.ts`, `src/server/db/schema/index.ts` (if tables are re-exported there), `src/server/db/data-contract.ts`, `src/server/db/app-role.int.test.ts`, `src/server/db/constraints.int.test.ts`
- Create: `drizzle/0023_*.sql` and its snapshot, from `pnpm db:generate`

**Interfaces:**
- **Produces:**
  - `windowLockTypes`, `alarmTypes`, `homeClaimTypes` and `priorClaimStatuses` in `values.ts`;
  - `properties.valuablesPence`, `properties.windowLocks` and `properties.alarmType`;
  - the table `priorClaims`: `{ id, quoteItemId, product, occurredOn, type, amountPence, status, fault, createdAt, updatedAt }`, using `itemOf("prior_claims", t, …)`.

  Its product check is `product in ('car','home')`. Write the FK with `foreignKey(...).onDelete("cascade")`, because `itemOf` fixes one product.

  Its checks are:
  - `prior_claims_amount_check` (`amount_pence >= 0`);
  - `prior_claims_type_check` (`homeClaimTypes`);
  - `prior_claims_status_check` (`status is null or status in priorClaimStatuses`);
  - `prior_claims_home_shape_check` (`product <> 'home' or (status is not null and fault is null)`).

  The data contract gets a `prior_claims` entry: copied, `kind: "mutable"`, every column kept. The three new `properties` columns are kept.

- [ ] **Step 1: Write the failing constraint tests** in `constraints.int.test.ts`, following the existing `properties` cases:
  - a `window_locks` of `"bars"` is refused;
  - an `alarm_type` of `"dog"` is refused;
  - a `prior_claims` row with type `"meteor"`, with status `"lost"`, or with `amount_pence -1` is refused;
  - a home row with `fault: "at_fault"` is refused;
  - deleting the quote item deletes its claims.

  Add `prior_claims: ALL` to `app-role.int.test.ts`.
- [ ] **Step 2: Run** `pnpm db:test:up`, then `vp test --project integration src/server/db`. Expected: FAIL (no table or columns).
- [ ] **Step 3: Change the schema,** then run `pnpm db:generate`. Check that the SQL only adds (`ADD COLUMN`, `CREATE TABLE`, `ADD CONSTRAINT`, `CREATE INDEX`) and has no unique index. Update `data-contract.ts`.
- [ ] **Step 4: Run** `vp test --project integration src/server/db` and `vp test --project unit src/server/db/data-contract.test.ts`, then `pnpm db:check`. Expected: PASS.
- [ ] **Step 5: Commit** the schema files, the migration SQL and the snapshot, and `meta/_journal.json`, each by name. `feat(db): store a home's valuables, window locks and alarm, and each past claim`

### Task 5: Home inputs and rows, and the seed

**Files:**
- Create: `src/features/rating/home-journey.ts`, `src/features/rating/home-journey.test.ts`, `src/features/rating/home-details.ts`, `src/features/rating/home-details.test.ts`
- Modify: `src/server/data/quote-rows.ts` (`HomeDetails.priorClaims`, `ItemRows.priorClaims`, `QuoteRowSet`), `src/server/data/save-quote.ts` (insert `priorClaims`), `src/server/data/save-quote.int.test.ts`, `scripts/seed/builders.ts`, `scripts/seed/cast.ts`, `scripts/seed/crowd.ts`, `scripts/seed/types.ts`, and the seed's insert step

**Interfaces:**
- **Consumes:** Task 3's `Journey` home parts, and Task 4's tables.
- **Produces:**
  - `homeInputsFromJourney(journey: Journey): HomeInputs`. The postcode area is the leading letters, as `carInputsFromJourney` does. Pounds become pence. `hasAlarm = alarm !== "none"`, and `pastClaims = any ? claims.length : 0`.
  - `homeDetailsFromJourney(journey: Journey): HomeDetails`. It returns `{ product: "home", property: {...every properties column, address from property.address, postcode normalised}, priorClaims: { occurredOn, type, amountPence, status, fault: null }[] }`.
  - `ItemRows.priorClaims` / `QuoteRowSet.priorClaims` rows: `id` from `newId`, plus `quoteItemId`, `product: "home"` and `createdAt`.

- [ ] **Step 1: Write the failing tests.**
  - **Unit,** with a fixture home journey in `src/features/quote/journey-fixtures.ts` (`HOME_JOURNEY`): rebuild `250000` becomes `25_000_000` pence; `alarm: "monitored"` gives `hasAlarm: true`; `any: false` with leftover claims gives `pastClaims: 0`; details carry one prior claim per claim.
  - **Integration** (`save-quote.int.test.ts`): saving a priced home item writes one `properties` row with `valuables_pence`, `window_locks` and `alarm_type`, plus 2 `prior_claims` rows for a 2-claim journey.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `detailsMatch` for home also checks `pastClaims === priorClaims.length`. Then update the seed:
  - `crowd.ts` picks `windowLocks`, `alarmType` (consistent with `hasAlarm`) and `valuablesPence` (≤ contents) from `rng`;
  - homes with `pastClaims > 0` get that many claim rows dated within 5 years of the seed's backdated quote date;
  - `cast.ts`'s named homes get fixed values.
- [ ] **Step 4: Run** `vp test --project unit src/features/rating`, `vp test --project integration src/server/data`, and the seed's own tests (`vp test scripts`). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(rating): a home journey's inputs and saved rows, with its past claims; the seed fills them`

### Task 6: Pricing and saving a home quote on the server

**Files:**
- Create: `src/server/quote/home-check.ts`, `src/server/quote/home-price.int.test.ts`, `src/server/quote/home-save.int.test.ts`
- Modify:
  - `src/server/quote/price.ts`: rename `carPrices` to `coverPrices(product, inputs, tables)`, keep a `carPrices` alias, and add `HomePriceResult` and `priceHomeJourney`;
  - `src/server/quote/save.ts`: add `SaveHomeResult`, `saveHomeQuoteFor` and `saveHomeQuote`;
  - `src/features/quote/server.ts`: add `priceHome` and `saveHomeQuoteFn`;
  - `src/server/auth/auth.ts`: the sign-up hook reads `quote.product`;
  - `src/server/auth/signup-quote.int.test.ts`.

**Interfaces:**
- **Consumes:** Task 5's `homeInputsFromJourney` and `homeDetailsFromJourney`, and Task 3's `firstIncompleteHomeStep`.
- **Produces:**
  - `checkHomeJourney(raw: { journey, voluntaryExcessPence }, now): Promise<{ ok: true; journey; inputs: HomeInputs; tables; today } | { ok: false; step: HomeStep | "cover" }>`. An unknown postcode area or a Crown dependency goes to `step: "property"`.
  - `type HomePriceResult = ({ status: "quoted" } & CoverPrices) | { status: "referred" | "declined"; namedDriver: null } | { status: "invalid"; step: HomeStep | "cover" } | { status: "rate_limited" }`, and `type QuotePriceResult = CarPriceResult | HomePriceResult`.
  - `priceHome` takes the same `{ journey, voluntaryExcessPence }` input as `priceCar`, with the same `quote.price` limit.
  - `saveHomeQuoteFor(tx, userId, { journey, now? }): Promise<SaveHomeResult>`, where `SaveHomeResult` is `SaveCarResult` with `step: HomeStep | "cover"`. It mirrors `saveCarQuoteFor`: `customerForQuote` from `homeAbout` plus the insured address.
  - `saveHomeQuoteFn` has the same envelope as `saveQuoteFn`.
  - **The sign-up body becomes `quote: { product?: "car" | "home"; journey }`.** A missing product means car.

- [ ] **Step 1: Write the failing integration tests.**
  - `priceHome`:
    - `HOME_JOURNEY` is quoted;
    - rebuild `1000000` → referred;
    - rebuild `2500000` → declined;
    - 3 claims → referred;
    - built `1700` → referred;
    - a journey without `contents` → `invalid: contents`;
    - a postcode `JE2 3AB` → declined (Crown dependency, as for car).
  - `saveHomeQuoteFor`:
    - saves a quoted home with a `customers` row from About you and the insured address;
    - saves a referred quote;
    - doesn't save a declined one;
    - two calls with one idempotency key through `saveHomeQuote` give one quote.
  - `signup-quote.int.test.ts`: a sign-up with `{ product: "home", journey: HOME_JOURNEY }` leaves one quote whose item is `home`.
- [ ] **Step 2: Run** `vp test --project integration src/server/quote src/server/auth`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Check the postcode area as `car-check.ts` does:
  - A Crown dependency passes the check, and `priceQuote`'s `coverAreaEligibility` declines it (`outside_cover_area`).
  - Any other area the active version doesn't know goes back to `property`.
- [ ] **Step 4: Run** the same command, then all of `vp test --project integration src/server`. Expected: PASS, with car's tests untouched.
- [ ] **Step 5: Commit.** `feat(quote): price and save a home quote on the server, from the gate or a sign-up`

### Task 7: Saved quotes, Confirm and pay, You're covered and Stripe know about home

**Files:**
- Modify: `src/server/data/quotes.ts`, its int test, `src/server/quote/checkout.ts`, `checkout.int.test.ts`

**Interfaces:**
- **Produces:** `interface PropertySummary { addressLine1: string; town: string; postcode: string; propertyType: string; bedrooms: number }`. `SavedQuoteCard`, `PaymentSummary` and `Purchase.policies[]` change `car: CarSummary` to `car: CarSummary | null` and gain `home: PropertySummary | null`. The item is found with `i.vehicle ?? i.property`. Checkout's line name is `Kerb home insurance, {Tier}, {addressLine1}` for a home item.

- [ ] **Step 1: Write the failing tests:**
  - `listMyQuotes` returns a saved home quote, with `home.addressLine1` set and `car: null`;
  - a saved car quote still has its `car`;
  - `getQuoteForPayment` on a home quote returns `home`;
  - the checkout session's line name for a home quote is `Kerb home insurance, Comprehensive, 18 Albion Road` (Stripe faked as in `checkout.int.test.ts`).
- [ ] **Step 2: Run** `vp test --project integration src/server/data/quotes src/server/quote/checkout`. Expected: FAIL.
- [ ] **Step 3: Implement it,** then fix the TypeScript errors this causes in `SavedQuotes.tsx`, `PayPage.tsx` and `CoveredPage.tsx` with a null check. The home rendering comes in Task 8.
- [ ] **Step 4: Run** the integration tests above and `vp check`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(quote): saved quotes, pay and checkout read a home quote's property`

### Task 8: The shared screens take a product

**Files:**
- Modify:
  - `price-query.ts`: `priceQuery(product, journey)`;
  - `QuotePrice.tsx`: split `usePrice(product, journey, onInvalid, onCover)` out of `useQuotePrice`;
  - `ChooseCover.tsx`: `useCoverPrice(product, journey, moves)`, with the product's copy;
  - `cover.ts`: `FEATURES` and `TIERS` become `coverCopy(product)`, and `addonCopy` learns home's three add-ons;
  - `BuyGate.tsx`: a `product` prop; the save function, `setSaved`, the overline, the `from`/`to` links and the waiting card follow it; the sign-up sends `{ product, journey }`;
  - `page-kit.tsx`: add `HomeCard`;
  - `PayPage.tsx`, `CoveredPage.tsx`, `SavedQuotes.tsx`: render `home` with `HomeCard`'s lines;
  - their browser tests.

**Interfaces:**
- **Consumes:** Task 6's `priceHome`, `saveHomeQuoteFn` and `QuotePriceResult`; Task 7's `PropertySummary`.
- **Produces:**
  - `HomeCard({ home: { line1: string; town: string; postcode: string; propertyType: string; bedrooms: number } | null; postcode: string; onChange?: () => void })`, titled "Your home", with "Change address" when `onChange` is given;
  - `coverCopy(product: BuyableProductId): { features: readonly { key: string; label: string }[]; tiers: Record<CoverLevel, { name; description; includes: Record<string, boolean> }> }`, with home's values as the spec gives them;
  - `onInvalid` callbacks take `"car" | DriverStep | HomeStep`.

- [ ] **Step 1: Write the failing component tests:**
  - `cover.browser.test.tsx`: Choose cover with `product="home"` shows `Buildings cover` and `Accidental damage`, and Essential's Accidental damage cell is "not included";
  - `buy.browser.test.tsx`: the home gate's overline reads `Home insurance / Buy`, and its waiting card shows the address;
  - `saved-quotes.browser.test.tsx`: a home card shows `18 Albion Road`, and a car card still shows its car;
  - `pay.browser.test.tsx`: the summary row reads `Property`.
- [ ] **Step 2: Check port 3000 is free,** then run `vp test --project component src/features/quote`. Expected: the new tests fail.
- [ ] **Step 3: Implement it.** Car callers pass `"car"`.
- [ ] **Step 4: Run** `vp test --project component src/features/quote` and `vp check`. Expected: PASS, with every car test unchanged apart from the added `product` props.
- [ ] **Step 5: Commit.** `feat(quote): cover, the gate, pay, You're covered and saved quotes for a home quote`

### Task 9: The home steps and `/quote/home`

**Files:**
- Create: `HomeSteps.tsx`, `HomeAboutStep.tsx`, `PropertyStep.tsx`, `ContentsStep.tsx`, `HomeClaimsStep.tsx`, `HomeQuote.tsx` (Your quote for home), `home.browser.test.tsx`, all in `src/features/quote/`
- Modify:
  - `Outcomes.tsx`: add `HomeDeclined`, and feed `HomeReferred` from the journey;
  - `search.ts`: `HomeSearch` with `step?: HomeQuoteStep`, where `HOME_QUOTE_STEPS = ["about", "property", "contents", "claims", "quote", "cover", "buy"]`;
  - `src/routes/_quote/quote.home.tsx`: its loader checks the postcode as `quote.car.tsx` does, and it renders `HomeSteps`;
  - `JourneyShell.tsx`: drop home's "arrives in 5.7" slot.

**Interfaces:**
- **Consumes:** everything above.
- **Produces:** `HomeSteps({ step, after, onStep, onRestart })`, with the same contract as `DriverSteps`. No step means `about`.
  - Steps the visitor can't reach yet are replaced, and focus moves to the heading.
  - "Edit" from Your quote returns there.
  - Choose cover's Continue goes to `buy`.
  - "Save and exit" goes to `buy` with `after: "retrieve"`.

- [ ] **Step 1: Write the failing component tests** in `home.browser.test.tsx`, with `findAddresses` and `priceHome` mocked:
  - **Tabs:** About you → Continue lands on Property; the Claims tab is locked until Contents is done.
  - **Property:**
    - picking `18 Albion Road` and filling the building fields reaches Contents;
    - "Enter address manually" shows the three address fields;
    - changing the postcode to `M1 1AE` and pressing Find address clears the picked address and asks for one again *(Review Focus 3)*;
    - a `not_found` lookup shows `We couldn't find that postcode. Check it and try again.`
  - **Contents:** valuables above contents shows the valuables message.
  - **Claims:**
    - Yes with no claims shows `Add the claim, or answer no.`;
    - Add another claim, then Remove, works;
    - "Get my home quote" with the box ticked lands on Your quote.
  - **Outcomes:** a `declined` price shows `We’re unable to offer home cover` and a link to `/quote/car?postcode=E8+3RL`.
  - **Axe:** `expectNoAxeViolations` on each step, as the car step tests do.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/home.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Use 5.4b's `JourneyPage`, `DetailsTabs`, `HelpCard`, `StepNav`, `StepHeading` and `YesNo`, plus car's `DateField` and money inputs.
  - Help lines:
    - About you, Property: `Have your property’s details to hand, like when it was built and its rebuild cost.`
    - Contents: `Count everything you’d take with you if you moved, at the price of buying it new.`
    - Claims: `Include claims for buildings or contents, made by anyone who lives with you.`
  - Your quote for home shows the price and the pay choice (`QuotePrice` driven by `usePrice`), and "Your details at a glance" has four rows with Edit buttons:
    - About you: `{name}, born {date}`;
    - Property: `{line1}, {property type}, {n} bedrooms`;
    - Contents: `£{contents} contents, {alarm label}`;
    - Claims: `None` or `{n} claim(s)`.
- [ ] **Step 4: Run** `vp test --project component src/features/quote` and `vp check`. Then start `vp dev`, open `/quote/home?postcode=E8+3RL`, go through to Choose cover, and stop `vp dev`. Expected: PASS, and the journey works by hand.
- [ ] **Step 5: Commit.** `feat(quote): the home steps, about you, your property, contents and security, and past claims, on /quote/home`

### Task 10: The home buy journey in Playwright, and the docs

**Files:**
- Create: `e2e/home-buy.spec.ts`
- Modify:
  - `e2e/quote-journey.ts`: add `withCompleteHomeJourney`, or a helper that fills the four steps;
  - `e2e/a11y.spec.ts`: if home steps go there rather than in the new spec;
  - `plan/phases/05-quote/phase.md`: 5.7's row; new rows for 5.7b (bundle) and 5.7c (car's unsaved answers); 5.7's testing rows;
  - `plan/build-plan.md`: the 5.7b and 5.7c boxes;
  - `plan/figma.md`: screens 05–07 built in 5.4b's frame with About you first and Bedrooms added; 04, 21 and 22 move to 5.7b;
  - `plan/phases/05-quote/07-home-steps.md`: Status, plus "Notes from the build".

**Interfaces:**
- **Consumes:** the whole slice. It follows `e2e/buy.spec.ts`'s helpers: `confirmEmailInDatabase`, `fillIfShown`, the Stripe frame, and its skip rules.

- [ ] **Step 1: Write `e2e/home-buy.spec.ts`** at 390 px:
  - landing → accordion `Get a home insurance quote` → postcode `E8 3RL` → About you → Property (pick the first address) → Contents → Claims (No) → Your quote → Choose cover → Continue;
  - create an account → confirm in the database → log in → Your saved quotes → Confirm and pay → in full → Stripe `4242 4242 4242 4242` → `You're covered`;
  - `/account` lists a policy whose line mentions `Home`.

  Run `expectNoSeriousAxeViolations` on each of the four home steps at 390, 768 and 1440 px.
- [ ] **Step 2: Run it against local `vp dev`,** with `stripe listen` forwarding to `/api/webhooks/stripe`, and `E2E_DATABASE_URL` and `VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY` set: `pnpm exec playwright test e2e/home-buy.spec.ts`. Expected: PASS. Without the keys it must skip, not fail.
- [ ] **Step 3: Update the docs** listed above. Leave the done-markers (Status `done`, the phase row, the build-plan box) until the PR, per `plan/git-workflow.md`.
- [ ] **Step 4: Run** `vp check`, `vp test` and `vp build`, with port 3000 free. Expected: all pass.
- [ ] **Step 5: Commit.** `test(e2e): buy a home quote with Stripe; docs: 5.7b and 5.7c in the plan`
