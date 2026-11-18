# 5.7c Car's unsaved answers, and employment for home

**Status:** done (spec approved by Damion, 17 Nov 2026)
**Phase:** 05-quote

## Goal

Every answer the quote journeys ask is stored, and home is priced on employment too:
- **Car:** each incident (date, type, fault, cost) is saved as a `prior_claims` row, and `drivers` gains licence type, employment status and a named driver's relationship to the policyholder.
- **Home:** About you also asks employment status and occupation. They're stored on the home's `properties` row and priced by a new home rating version (v2) with an occupation factor.
- **Bundle:** employment status and occupation are asked once and carry across, as name, date of birth and address already do (5.7b, decision 3).

- **Why:** 5.3 asks car questions that a saved quote drops, so a policy can't show what the customer told us. 5.7 built `prior_claims` with car in mind (its type list "widens in 5.7c"). Home without occupation misses a factor UK home insurers do use. Damion set the scope on 16 and 17 Nov 2026 ([phase.md](phase.md), 5.7c).

## What exists already

- **Car journey (5.3):** the main driver's About you has `status` and `occupation`. Licence and driving has `licenceType` (`full_uk`, `full_eu`; provisional is refused). Claims has up to 10 `incidents` (`date`, `type`, `fault`, `costPounds`). Each named driver has `relationship`, `status`, `occupation`, `licenceType` and a claims count, with no claim details.
- **What car saves today (`carDetailsFromJourney`):** `drivers` keeps name, date of birth, occupation, licence years, no-claims years and a claims count. Licence type, employment status, relationship and the incidents' details are lost.
- **`prior_claims` (5.7, migration 0023):** one row per home claim. `type` is checked against `homeClaimTypes`. A home row must have a `status` and no `fault`. The foreign key on `(quote_item_id, product)` cascades on delete.
- **Home's About you (5.7):** first name, last name and date of birth, saved to `customers` only (`saveHomeQuote` → `customerForQuote`).
- **Rating:** each `quote_items` row keeps its `ratingVersionId`, and `getActiveRatingTables` reads the active version per product with no cache, so a v2 takes over at once. A deploy writes every file in `RATING_SOURCES` and makes the newest active from its `effectiveFrom`. `home-v1.ts` says "never edit once deployed: add home v2 instead". Car v1 rates occupation through an `occupation` lookup (key → band A–E) and an `occupation_band` factor. `/api/occupations` serves the active car version's list to the picker.
- **Bundle carry (5.7b):** `prefillAbout` copies name and date of birth both ways. Screen 21's "Add home insurance" writes home's About you from car's main driver, so the home steps open at Property. `saveBundleQuote` refuses a bundle whose name or date of birth differ (`samePerson` → `mismatch`).

## Decisions

1. **Car's incidents are `prior_claims` rows** (Damion, 16 Nov 2026).
   - **One row per incident on the main driver's item:** `product` `car`, `occurred_on` the date, `type`, `fault`, `amount_pence` = cost × 100, `status` null.
   - **Types per product.** A new `carClaimTypes` (`collision`, `theft`, `fire`, `vandalism`, `windscreen`, `other`, the incident options' values) joins `homeClaimTypes` in `values.ts`. The single type check becomes one check per product: a car row's type is in `carClaimTypes`, a home row's in `homeClaimTypes`.
   - **Car's shape:** a car row has a `fault` (checked against a new `faultTypes`: `at_fault`, `not_at_fault`, `undecided`) and no `status`, mirroring home's shape check.
   - **Named drivers' claims stay a count** on their `drivers` row. The form asks how many, not what happened.
   - **The rated count doesn't change.** `pastClaims` is still the number the engine reads. It equals the incident rows for the main driver, as `properties.past_claims` does for home.
   - **Rows belong to the item, not a driver** *(my call: only the main driver's incidents have details, so a `driver_id` column would always point at the main driver)*.
   - **`CarDetails` gains `priorClaims`,** and `quote-rows.ts`' check that the rows match the claims count covers car as it does home.
2. **`drivers` gains three columns** (Damion, 16 Nov 2026).
   - **`licence_type`:** `full_uk` or `full_eu`.
   - **`employment_status`:** the six statuses in `occupation.ts` (`employed`, `self_employed`, `retired`, `unemployed`, `student`, `homemaker`), moved to a `employmentStatuses` constant in `values.ts` that `occupation.ts` reads.
   - **`relationship`:** the seven relationship options' values. Null on the main driver, set on every named driver.
   - **Nullable, for rows saved before 5.7c** *(my call: a backfill can't know a job-holder's status or anyone's licence type)*. Each has a check: null or in its list. A further check says a main driver has no relationship. The app always writes all three (relationship for named drivers only), and a test proves it.
3. **Home's About you asks employment status and occupation** (Damion, 17 Nov 2026).
   - **The same two fields as car's About you,** in the same order after date of birth: Employment status, then Occupation for employed and self-employed. They use the same `checkOccupation` rule and the same picker fed by `/api/occupations` *(my call: the screens don't have them in Figma; car's About you is the pattern)*.
   - **Stored on `properties`** as `employment_status` and `occupation` (Damion, 17 Nov 2026: "with the home quote", so each quote keeps the answers it was priced on, as car's `drivers.occupation` does). Nullable for rows saved before 5.7c, with the same list check for status. The app always writes both.
   - **A tab saved before 5.7c** has a `homeAbout` without them. The journey store still reads it, and the home tabs' rules count About you as not finished, so the visitor is sent back to answer the two questions *(my call)*.
4. **Home rating v2** (Damion, 17 Nov 2026).
   - **`home-v2.ts` is v1 plus an occupation factor.** Everything else is copied unchanged. Its `effectiveFrom` is the day the slice merges, after v1's 1 Nov 2026 (the deploy checks this).
   - **One shared occupation list.** Car v1's occupation list (each key, label and band) moves into a shared module that `car-v1.ts` and `home-v2.ts` both import. Home v2 carries the same `occupation` lookup, so each version still holds all of its own tables. Car v1's data doesn't change: `contentHash(carV1)` is the same before and after, and a test pins it.
   - **Not chosen:** home reading car's active occupation table at pricing time (a car v2 would quietly reprice home), and typing the bands into home v2 again (the two copies drift).
   - **Home's multipliers, on the whole premium** *(my call: home insurers weight occupation lightly)*: A 0.95, B 0.97, C 1, D 1.03, E 1.06. They multiply the buildings and contents sections together, before the tier.
   - **`HomeInputs` gains `occupation`.** `rateHome` applies the factor only when the version has an `occupation_band` factor, so pricing with v1's tables ignores it.
   - **Quotes saved under v1 keep v1's price.** Their items point at v1, and nothing reprices a saved item. A home journey priced in the tab before the deploy is priced under v2 the next time it's priced, as any version change is.
   - **The reference homes still land in range.** H1, H2 and H3 gain a band C occupation (`doctor`), so their hand prices don't move. A new H4, an H1 with a band E occupation (`taxi_driver`), checks the factor end to end with its own hand price.
5. **In a bundle, employment is asked once** (Damion, 17 Nov 2026).
   - **`prefillAbout` also copies `status` and `occupation`,** both ways, with name and date of birth. The visitor can still change them.
   - **Screen 21's "Add home insurance"** writes all five answers from car's main driver into home's About you, so the home steps still open at Property.
   - **Home's About you shown in a bundle** (started from home, or a driver under 18) starts filled in from car, as name and date of birth do.
   - **No new mismatch check** *(my call)*. `samePerson` still compares name and date of birth only. Each item stores its own answers, as the address can differ between car and home.
6. **Kept in step** (as 5.7, decision 10):
   - **Migration 0024**, written by `drizzle-kit generate`: the `drivers` and `properties` columns and checks, and `prior_claims`' new per-product type and shape checks. It adds no unique index, so no dedupe step.
   - **`prior_claims`' existing check is replaced.** Only home rows exist, and they all pass the home check.
   - **The data contract** (`data-contract.ts` and its test) lists the new columns.
   - **`db:check-app-role`:** the app role's grants already cover the columns. Its test confirms it.
   - **Account closure:** car's `prior_claims` rows go with their quote by the existing cascade, so nothing is added there. Its test gains a car incident to prove it.
   - **The seed** fills the new columns and adds incident rows for seeded car quotes that have claims.
   - **`journey-fixtures.ts`** gains status and occupation on `homeAbout`.

## Out of scope

- **Showing the stored answers** on `/account`, policy detail or the documents (Phase 6, 6.2).
- **Pricing on incident details, licence type or relationship.** Car v1 is used as it is, and it rates a claims count.
- **Named drivers' claim details.** Their form asks for a count only.
- **A car rating v2.**
- **Dependabot alert #1** (esbuild through drizzle-kit, development only): a separate dependency PR.

## Tests

| Layer | What |
|---|---|
| Unit | `carDetailsFromJourney`: licence type, employment status and relationship on each driver (none on the main driver); one `priorClaims` entry per incident with fault and pence; none after "No" with incidents left from a "Yes" |
| Unit | `homeDetailsFromJourney` and `homeInputsFromJourney` carry employment status and occupation. Home's About you schema: status required, occupation by the same rules as car's |
| Unit | Home v2 rates the occupation band on the whole premium; v1's tables ignore it. `contentHash(carV1)` is unchanged. Home v2's source validates, and its `occupation` lookup equals car v1's |
| Unit | Calibration: H1–H3 at their old hand prices under v2; H4 at its own |
| Unit | `homeStepState`: a `homeAbout` without status counts as not finished. `prefillAbout` carries status and occupation both ways |
| Component | Home's About you: Employment status shows Occupation for employed and self-employed only, and is filled from car in a bundle |
| Integration | The migration's checks: a car claim needs a fault and no status, a home claim the reverse; a type from the other product's list is refused; a main driver with a relationship is refused |
| Integration | `saveCarQuote` writes the new `drivers` columns and one `prior_claims` row per incident. `saveHomeQuote` writes status and occupation on `properties` and prices under v2. A quote item saved under v1 keeps its price when paid after v2 is active |
| Integration | `saveBundleQuote` stores both items' answers. Account closure removes car's `prior_claims` |
| E2E | The car and home buy journeys answer the new home questions. The bundle E2E reaches home's Choose cover without asking employment again |

## Done when

- [x] A car quote with two incidents and a named driver, saved on the preview, has two car `prior_claims` rows and each driver's licence type, employment status and relationship in the database (Damion's preview check, 18 Nov 2026: KRB-Q-88174 has a collision, at fault, £1,200, and a windscreen claim, not at fault, £650, as car rows with no status. John is `full_uk` / `employed` / `engineer` with no relationship and 2 claims. Jason is `full_eu` / `self_employed` / `farmer` / `friend`).
- [x] A home quote asks employment status and occupation, is priced under home v2, and stores both on `properties` (E2E `home-buy.spec.ts` on the preview, 18 Nov 2026: the property row has `employed` / `teacher`, and the item is home v2 with `occupation_band` B at 0.97).
- [x] A bundle started from car doesn't ask employment again on the home side (E2E `bundle-buy.spec.ts` on the preview, 18 Nov 2026: home opens at Property).
- [x] The reference homes land in their expected ranges under v2, and car v1's content hash is unchanged (`calibration.test.ts` H1–H4, `hash.test.ts` "car v1 hashes as deployed").
- [ ] Staging's build log shows the reference data with `home v2` (`unchanged`: `db:reference` already wrote it to `dev`, which staging shares) and home v2 active.
- [x] `vp check`, `vp test`, the integration tests and the E2E pass (CI on #102; the four buy E2E tests run locally against the preview on 18 Nov 2026, since `e2e.yml` runs main's copy of the specs).

## Notes from the build

- **Before the preview tests:** the preview reads the dev database, which needs migration 0024 (`db:migrate`) and home v2 (`db:reference`) first. Previews run neither.
- **A short window on the first deploy** (found by the final review; Damion, 18 Nov 2026: accepted):
  - Every load re-checks a rating version, and code from before 5.7c rejects `occupation_band` as an unknown factor.
  - The build activates home v2 before the new code serves, so for those few minutes the old deployment can't price home or a bundle. Car is unaffected.
  - This happens once on staging, and once on production at the Phase 5 release.
- **Don't roll back past this slice** without first setting home v1 back to `active` by hand. Older code can't load home v2.
- **Home v2's `effectiveFrom` is 18 Nov 2026.** The deploy only needs it after v1's 1 Nov, and it activates v2 as soon as it's written.
- **The validator allows home's `occupation_band` without requiring it** (`OPTIONAL_FACTORS` in `validate.ts`), so v1 stays valid and v2 is checked with it.
- **The calibration and source tests use each product's newest version,** because only home v2 knows the reference homes' occupations.
- **Found at checkpoint 2:** an occupation key the active version doesn't know threw a server error when home was priced. It now sends the visitor back to About you, as car's check does (`home-check.ts`).
- **Left as they are:**
  - A home tab saved before 5.7c, then bundled from screen 21, keeps its old About you, so the visitor answers employment there once.
  - The new `drivers` columns are nullable for old rows, so the database doesn't require them on new rows. The app always writes them, and the tests check that.
- **The seed** gives each car incident a `prior_claims` row and each seeded home its policyholder's occupation.
