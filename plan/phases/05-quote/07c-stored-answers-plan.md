# 5.7c Car's unsaved answers, and employment for home: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a saved car quote keeps every answer (incidents as `prior_claims` rows; licence type, employment status and relationship on `drivers`), and home asks employment status and occupation, stores them on `properties` and is priced by home rating v2.

**Architecture:**
- **One migration (0024)** adds the columns and replaces `prior_claims`' type check with per-product checks. The stored value lists live in `values.ts`; the form option lists are tested against them.
- **The occupation list moves to a shared module** that car v1 and the new home v2 both import, so car v1's data (and hash) stays the same. `rateHome` applies `occupation_band` only when the version has it.
- **Home's About you reuses car's `OccupationField` and `checkOccupation`.** `prefillAbout` and screen 21 carry status and occupation across a bundle.

**Tech Stack:** TanStack Start, React, Zod 4, Drizzle on Postgres, Vitest (projects `unit`, `integration`, `component`), Playwright.

**Spec:** [07c-stored-answers.md](07c-stored-answers.md). Read decisions 1–6 and "What exists already" first.

## Global Constraints

- **Car's price doesn't change.** Car v1 is untouched as data: `contentHash(carV1)` before and after Task 3 is the same string. Every existing car test passes unchanged.
- **Home v2 multipliers, on the whole premium:** `occupation_band` A 0.95, B 0.97, C 1, D 1.03, E 1.06.
- **Home v2's `effectiveFrom`** is the merge day, at least `2026-11-18` (the deploy refuses a date not after v1's `2026-11-01`).
- **Stored values:** licence `full_uk`, `full_eu`; status `employed`, `self_employed`, `retired`, `unemployed`, `student`, `homemaker`; relationship `spouse`, `partner`, `parent`, `child`, `sibling`, `other_relative`, `friend`; car claim types `collision`, `theft`, `fire`, `vandalism`, `windscreen`, `other`; fault `at_fault`, `not_at_fault`, `undecided`.
- **New columns are nullable** (rows saved before 5.7c); the app always writes them, relationship for named drivers only.
- **Migration 0024 is generated** (`vp run db:generate`), adds no unique index and needs no dedupe step. After merge, ask Damion to run `db:migrate` on dev before preview tests.
- **Commits:** each ends with both trailers:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name. Never stop `vp dev` to run tests; check port 3000 is free before component tests or a build.
- **Execution mix:** inline, with a Sonnet review after Task 2 (car saving, shipped code) and after Task 5 (home screens and bundle), then one whole-branch review before the PR.

## Review Focus

1. **A car journey answered "No" to claims after adding incidents:** no `prior_claims` rows, `pastClaims` 0. *Test in Task 2.*
2. **A home tab from before the deploy** (`homeAbout` without status): the journey still parses, About you counts as not finished, and the gate can't save. *Test in Task 4.*
3. **A home quote saved under v1, paid after v2 is active:** the premium charged is the saved v1 premium. *Test in Task 4.*
4. **A stored occupation the v2 list doesn't know** (cannot happen today, but `OccupationField` clears unknown keys): rating throws `has no band`, so the step must ask again rather than price. *Covered by `OccupationField`'s existing behaviour; Task 5 checks home's About you with an unknown key shows the field empty.*
5. **Bundle from car with a retired main driver:** home's About you gets `status: "retired"`, `occupation: "retired"` and is skipped. *Test in Task 5.*

---

### Task 1: Stored value lists, columns and migration 0024

**Files:**
- Modify: `src/server/db/schema/values.ts`, `src/server/db/schema/products.ts` (`drivers`, `properties`, `priorClaims`), `src/features/quote/occupation.ts` (`EmploymentStatus` from `employmentStatuses`), `src/server/db/data-contract.ts`
- Create: `drizzle/0024_*.sql` (generated)
- Test: `src/server/db/constraints.int.test.ts`, `src/features/quote/schemas/driver-steps.test.ts`, `src/server/db/data-contract.test.ts`

**Interfaces:**
- Produces: `carClaimTypes`, `faultTypes`, `licenceTypes`, `employmentStatuses`, `relationshipTypes` (`as const` arrays in `values.ts`). Columns `drivers.licenceType`, `drivers.employmentStatus`, `drivers.relationship`, `properties.employmentStatus`, `properties.occupation` (all `text()`, nullable).
- Checks: `drivers_licence_type_check`, `drivers_employment_status_check`, `drivers_relationship_check` (each `is null or oneOf`), `drivers_main_relationship_check` (`not is_main or relationship is null`), `properties_employment_status_check`, `prior_claims_type_check` replaced by `(product = 'car' and type in carClaimTypes) or (product = 'home' and type in homeClaimTypes)`, `prior_claims_fault_check` (`fault is null or oneOf faultTypes`), `prior_claims_car_shape_check` (`product <> 'car' or (fault is not null and status is null)`).

- [ ] **Step 1: Failing tests.**
  - `driver-steps.test.ts`, "the option lists are the stored lists": `values(incidentTypeOptions)` equals `carClaimTypes`, `faultOptions` → `faultTypes`, `relationshipOptions` → `relationshipTypes`, `licenceOptions` without `provisional` → `licenceTypes`, `statusOptions` → `employmentStatuses`.
  - `constraints.int.test.ts`, "prior_claims per product": a car row with fault and no status inserts; a car row with a status, without a fault, or with type `escape_of_water` is refused; a home row with type `collision` is refused.
  - "drivers' new columns": a main driver with `relationship: "spouse"` is refused; `licenceType: "provisional"` and `employmentStatus: "contractor"` are refused; nulls insert.
  - "properties' employment": `employmentStatus: "contractor"` refused, null inserts.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/schemas/driver-steps.test.ts` and (with `vp run db:test:up`) `vp test --project integration src/server/db/constraints.int.test.ts`. Expected: FAIL (missing exports, columns).
- [ ] **Step 3: Add the lists, columns and checks;** `vp run db:generate`; add the columns to `data-contract.ts` with one-line descriptions as its neighbours have.
- [ ] **Step 4: Run** the two tests above, plus `src/server/db/data-contract.test.ts` and `scripts/check-app-role.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): drivers keep licence type, employment and relationship, homes keep employment, and prior_claims takes car incidents (0024)`.

### Task 2: A saved car quote keeps every answer

**Files:**
- Modify: `src/server/data/quote-rows.ts` (`CarDetails`, `detailsMatch`, `itemRows`), `src/features/rating/car-details.ts`
- Test: `src/features/rating/car-details.test.ts`, `src/server/quote/save.int.test.ts` (or the file holding `saveCarQuoteFor`'s tests)

**Interfaces:**
- Consumes: Task 1's columns and lists.
- Produces: `CarDetails.priorClaims: PriorClaimDetail[]`; each `CarDetails.drivers[i]` gains `licenceType`, `employmentStatus`, `relationship` (null on the main driver). `detailsMatch` for car also requires `details.priorClaims.length === details.drivers[0].pastClaims`.

- [ ] **Step 1: Failing tests** in `car-details.test.ts`:
  - "stores licence type, employment and relationship": the fixture's main driver gives `licenceType: "full_uk"`, its `status`, `relationship: null`; each named driver its own three.
  - "one prior claim per incident": two incidents → two entries `{ occurredOn, type, fault, amountPence: costPounds * 100, status: null }`.
  - "No ignores incidents left from Yes": `claims.any = false` with incidents → `priorClaims: []`, main `pastClaims: 0`.
  - `save.int.test.ts`, "a car quote saves its drivers' answers and incidents": after `saveCarQuoteFor`, the `drivers` rows have the three columns and `prior_claims` has one `car` row per incident.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `itemRows` writes `details.priorClaims` with `product: "car"` as it does for home.
- [ ] **Step 4: Run** the tests above and the whole `unit` and `integration` projects. Expected: PASS, no existing car test edited except fixtures gaining the new fields.
- [ ] **Step 5: Commit** `feat(quote): a saved car quote keeps each incident, licence type, employment status and a named driver's relationship`.
- [ ] **Step 6: Checkpoint review** (Sonnet) of Tasks 1–2.

### Task 3: Home rating v2 with the shared occupation list

**Files:**
- Create: `src/server/reference/rating/occupations.ts`, `src/server/reference/rating/home-v2.ts`
- Modify: `src/server/reference/rating/car-v1.ts` (import the list), `src/server/reference/rating/index.ts` (`RATING_SOURCES` adds `homeV2`), `src/features/rating/types.ts` (`HomeInputs.occupation: string`), `src/features/rating/rate.ts` (`rateHome`), `src/server/reference/rating/calibration.ts` (H1–H3 `occupation: "doctor"`, new H4, `lookupKeys` gain `occupation:…`)
- Test: `src/server/reference/rating/hash.test.ts`, `sources.test.ts`, `src/features/rating/rate.test.ts`, `calibration.test.ts`, `src/server/data/reference.int.test.ts`

**Interfaces:**
- Produces: `OCCUPATION_BANDS` (the `rows` argument `listLookups` takes, bands A–E exactly as car v1 has them today); `homeV2: RatingSource`; `Tables.hasFactor(factor: string): boolean` if `Tables` has no such check yet.

- [ ] **Step 1: Pin car v1's hash before touching it.** Run `node -e` (or a throwaway test) printing `contentHash(carV1)`; add to `hash.test.ts` "car v1 is unchanged by the shared occupation list": `expect(contentHash(carV1)).toBe("<that hash>")`. It passes now.
- [ ] **Step 2: Failing tests.**
  - `sources.test.ts`: `RATING_SOURCES` has car v1, home v1, home v2, business v1; home v2's `occupation` lookups equal car v1's; home v2 equals v1 apart from version, `effectiveFrom`, notes, the `occupation_band` factor rows and the lookups; "the spec's thirteen people".
  - `rate.test.ts`: under home v2, an E occupation's `base` is 1.06 × the same home at C, and the factors include `{ factor: "occupation_band", inputValue: "E", multiplier: 1.06 }`; under home v1 the occupation is ignored (no `occupation_band` factor).
  - `calibration.ts`: H4 = H1 with `occupation: "taxi_driver"`, `expected: { outcome: "quoted", minPence: 25_000, maxPence: 40_000, handPence: 33_101 }` (H1's £278.81 × 1.06 × 1.12). The calibration test prices home people with home v2 (`sourceFor`), and H1–H3 keep their hand prices.
  - `reference.int.test.ts`: the first deploy reports `{ product: "home", version: 2, action: "inserted" }`, and the active home version is 2.
- [ ] **Step 3: Run** them. Expected: FAIL.
- [ ] **Step 4: Implement.** `home-v2.ts` spreads `homeV1` and appends the factor and lookup rows; its header comment says it is v1 plus occupation (5.7c). `rateHome` multiplies `base` by the occupation factor (after the past-claims factor) when the version has `occupation_band`.
- [ ] **Step 5: Run** the tests above, `hash.test.ts` included. Expected: PASS, car v1's hash unchanged.
- [ ] **Step 6: Commit** `feat(rating): home rating v2 prices the policyholder's occupation with car's bands, and car v1 shares its occupation list unchanged`.

### Task 4: Home's answers carry employment from the tab to the database

**Files:**
- Modify: `src/features/quote/schemas/home-steps.ts` (`homeAboutSchema`), `src/features/quote/schemas/driver-steps.ts` (export `checkOccupation`, or move it to `fields.ts`), `src/features/quote/journey-store.ts` (`homeAboutSchema` gains optional `status`, `occupation`), `src/features/rating/home-journey.ts`, `src/features/rating/home-details.ts`, `src/features/quote/journey-fixtures.ts`
- Test: `schemas/home-steps.test.ts`, `src/features/quote/home-steps.test.ts`, `home-journey.test.ts`, `home-details.test.ts`, `src/server/quote/save.int.test.ts`, `src/server/data/pay-quote.int.test.ts` (or where paying a home quote is tested)

**Interfaces:**
- Consumes: Task 1's `properties` columns, Task 3's `HomeInputs.occupation`.
- Produces: `HomeAbout` = `{ firstName, lastName, dateOfBirth, status: EmploymentStatus, occupation: string }`; `HomeDetails.property` gains `employmentStatus`, `occupation`.

- [ ] **Step 1: Failing tests.**
  - `home-steps.test.ts` (schema): status required (`Choose your employment status.`); employed needs a job; retired stores `retired`; the same cases `driver-steps.test.ts` has for About you.
  - `home-steps.test.ts` (state): a stored `homeAbout` without `status` parses from storage, and `firstIncompleteHomeStep` returns `"about"`.
  - `home-journey.test.ts`: `homeInputsFromJourney` gives `occupation`. `home-details.test.ts`: `property.employmentStatus` and `property.occupation`.
  - `save.int.test.ts`, "a home quote saves employment and prices under v2": `properties` has both columns; the item's `ratingVersionId` is home v2's.
  - Pay test, "a home quote saved under v1 keeps its price after v2": save under v1 tables, activate v2, pay; the charged premium equals the saved one.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement;** fixtures' `homeAbout` gains `status: "employed"`, `occupation: "teacher"`.
- [ ] **Step 4: Run** `unit` and `integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): home's About you takes employment status and occupation, stored with the home and priced by v2`.

### Task 5: Home's About you screen, and employment across a bundle

**Files:**
- Modify: `src/features/quote/HomeAboutStep.tsx` (add `OccupationField` after Date of birth), `src/features/quote/bundle.ts` (`Person` gains `status`, `occupation`; `prefillAbout` copies them), `src/features/quote/DriverSteps.tsx` (screen 21 writes all five), `AboutYouStep.tsx` (its prefill from home now includes status and occupation)
- Test: `HomeAboutStep.browser.test.tsx` (create if absent, following the other step tests), `src/features/quote/bundle.test.ts`, `bundle.browser.test.tsx`

**Interfaces:**
- Consumes: Task 4's `HomeAbout`.

- [ ] **Step 1: Failing tests.**
  - `bundle.test.ts`: `prefillAbout` from a car journey gives status and occupation; from a home journey too; from a pre-5.7c `homeAbout` gives them `undefined`.
  - Home About you: Employment status shows; choosing Employed shows Occupation, Retired doesn't; submitting with nothing shows `Choose your employment status.`; a stored unknown occupation key shows the field empty.
  - `bundle.browser.test.tsx`: "Add home insurance" with a retired main driver stores `homeAbout` with `status: "retired"`, `occupation: "retired"` and opens Property; home's About you in a bundle starts with car's status and job.
- [ ] **Step 2: Run** `vp test --project component` on those files (port 3000 free). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `vp test --project component` and `unit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): home's About you asks employment, and a bundle carries it across both ways`.
- [ ] **Step 6: Checkpoint review** (Sonnet) of Tasks 3–5.

### Task 6: Seed, closure, E2E and the plan's markers

**Files:**
- Modify: `scripts/seed/builders.ts` (and `types.ts`/`write.ts` as needed), `src/server/data/account.int.test.ts`, `e2e/quote-journey.ts` and `e2e/home-buy.spec.ts`, `e2e/bundle-buy.spec.ts`; `plan/phases/05-quote/07c-stored-answers.md` (Status, "Notes from the build"), `phase.md` (5.7c row → done), `plan/build-plan.md` (5.7c box)
- Test: `scripts/seed/generate.test.ts`, `scripts/seed/write.int.test.ts`, the E2E files

- [ ] **Step 1: Failing tests.** Seed: generated car items with claims have one `prior_claims` car row per claim, drivers carry the three columns, homes carry employment. Closure: closing an account with a car quote that has an incident leaves no `prior_claims` rows for it.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement;** the home E2E helper answers Employment status (Employed, Teacher); the bundle E2E asserts home's About you isn't shown.
- [ ] **Step 4: Run** `vp check`, `vp test`, the integration project, and `vp exec playwright test e2e/home-buy.spec.ts e2e/bundle-buy.spec.ts e2e/buy.spec.ts` locally. Expected: PASS.
- [ ] **Step 5: Mark done** in the same PR (spec Status, `phase.md`, `build-plan.md`), then commit `test(e2e): home and bundle journeys answer employment; docs: 5.7c done`.
- [ ] **Step 6: Whole-branch review,** then the PR per `plan/git-workflow.md`.
