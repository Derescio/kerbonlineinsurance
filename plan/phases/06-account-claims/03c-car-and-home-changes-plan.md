# 6.3c Change car and home policy changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change car on a car policy, and Change cover, Update contents and Update security on a home policy, each through 6.3b's change path: re-priced on the bought rating version, shown before Confirm, settled in Stripe, and recorded as a snapshot v2 `policy_versions` row.

**Architecture:**
- **Request kinds:** `PolicyChangeRequest` ([request.ts](../../../src/features/policy-changes/request.ts)) gains `car_replaced`, `home_contents` and `home_security`. The server turns a `car_replaced` request into a **resolved** change carrying the catalogue row, so pricing and applying never see browser car details.
- **Stored policy:** `StoredPolicy` becomes a union on `product` (`car` | `home`). Car keeps today's fields; home carries its `properties` rating rows.
- **Pricing:** `priceSide` builds `CarInputs` or `HomeInputs` (new `homeInputsFromPolicy`) and calls `priceQuote` with the matching product. Settlement (`settle.ts`) doesn't change: it already works on `PricedChange` and the quote's payments.
- **Snapshot v2:** adds `vehicle` and `property`, and a home's place from `properties`. Readers accept v1 and v2.

**Tech Stack:** TanStack Start (server functions), Drizzle + Postgres (drizzle-kit migrations), Stripe (`src/test/stripe-fake.ts` in tests), Vitest (`vp test`: unit, integration, browser), Playwright.

**Spec:** [03c-car-and-home-changes.md](03c-car-and-home-changes.md). Figma: 02 Change car `183:3785`, 02b `282:3977`, 02c `282:4033`, 08 Home Make a change `282:4089`, 09 Update contents `282:4145`, 10 Update security `282:4201`, 11 Change cover (home) `282:4257`.

## Global Constraints

**Branch and commits:**
- Branch `slice/6.3c-car-and-home-changes`, made from `staging`.
- Stage files by name, never a folder. Check `git status` before every commit: Damion edits `plan/` alongside.
- Every commit ends with both lines:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

**Local running:**
- Don't run browser tests or `vp build` while `vp dev` is running.
- The migration is never run against `dev`/staging from this branch. Local integration and E2E only (`vp run db:test:up`). E2E with Stripe follows the `stripe listen` + `vp dev` recipe.

**Carried over from 6.3b, unchanged:** today-only changes; re-pricing twice on `quote_items.rating_version_id`; the saving rule; the money rules and price lines; one open change and the version check; settlement; the toast and `policy_changed` email. A referred or declined price on either side means nothing applies.

**Copy, verbatim:**
- Cards: "Change car"; home: "Change cover" / "Cover level and add-ons", "Update contents" / "What your belongings are worth", "Update security" / "Locks and alarms".
- Change car: "New car's registration", "We found it: {make} {model}, {year}", "We couldn't find that car", "Check the registration and try again, or choose your car from our list.", "Choose my car manually", "Look up by registration instead", "Make", "Model", "Year", "Variant", "Current mileage", hint "What the new car's odometer reads now.", "That's the car you're already insured for."
- Update contents: "Total contents value" (hint "Cost to replace everything as new."), "Valuables total" (hint "Included within your contents total."), note "Include furniture, clothes, electronics and other belongings. Valuables include jewellery, watches and artwork."
- Update security: "Main external door lock" (hint "Choose the closest match."), "Window locks", "Burglar alarm", "Smoke alarms are fitted and working"; options are `lockTypeOptions`, `windowLockOptions` and `alarmOptions` from `#/features/quote/schemas/home-steps`.
- Every refusal: "We can't make this change online." (`CANT_CHANGE_ONLINE`).
- Email lines: "Your car is now a {make} {model} ({year})." / headline "car changed"; "Your contents are now covered for £{contents}, with valuables of £{valuables}." / "contents updated"; "Your home's security details are updated." followed by one sentence per changed field / "security updated".

**Audit** (entity `policy`; never a registration, name or address):
- `policy.car_changed` `{ make, model, year, insurance_group }`, each `{ from, to }`
- `policy.contents_changed` `{ contents_value_pence, valuables_pence }`, each `{ from, to }`
- `policy.security_changed`: each of `lock_type`, `window_locks`, `alarm_type`, `has_smoke_alarm` that moved, as `{ from, to }` (`from` may be null)
- A home cover change uses 6.3b's `policy.cover_changed`.

**Out of 6.3c:** Review renewal and Cancel policy cards (both products), moving house, home voluntary excess, a real plate lookup, 6.3b's left-for-later list, re-backfilling v1 snapshots.

## Review Focus

1. **A bundle's home changed.** It's priced with the bundle saving rate, settled on the one shared payment or subscription, and the car's `annual_premium_pence` doesn't move. Test in Task 4.
2. **A plate typed any way** ("yr21kzp", " YR21  KZP ") resolves the same, and a demo plate sent with another car's `catalogueVariantId` is refused. Test in Task 3.
3. **A home bought on home v1 with no `occupation`** prices without throwing, and the same change prices the same on v1 as before 5.7c. Test in Task 2.
4. **A home whose `alarm_type` is null** opens Update security with Burglar alarm empty. The server never treats it as "none": a request that changes only smoke alarms keeps `has_alarm`. Test in Task 4 (server) and Task 5 (dialog).
5. **A new car that refers** (insurance group ≥ `refer_insurance_group_min`) or that the rating version has no band for. Both refuse with the one message, and nothing is applied or thrown. Test in Task 3.

---

### Task 0: Branch, docs commit and push

**Files:**
- `plan/phases/06-account-claims/03c-car-and-home-changes.md`
- `plan/phases/06-account-claims/03c-car-and-home-changes-plan.md`
- `plan/figma.md` (list 02b, 02c and 08–11 under Account · Policy, with their ids, and note 02's mileage field)

- [ ] **Step 1:** `git switch -c slice/6.3c-car-and-home-changes` from an up-to-date `staging`.
- [ ] **Step 2:** `git add` the three files by name. Commit `docs(account): 6.3c car and home policy changes spec and plan` with the two trailers.
- [ ] **Step 3:** `git push -u origin slice/6.3c-car-and-home-changes`. Expected: the branch exists on origin and no PR is opened yet.

---

### Task 1: Kinds, migration and snapshot v2

**Files:**
- Modify: `src/features/policy-changes/request.ts`, `src/features/policy-changes/schema.ts`, `src/server/db/schema/values.ts`, `src/server/data/policy-version-rows.ts`, `src/server/db/data-contract.ts`, `src/server/data/policies.ts` (wherever it reads `snapshot`)
- Create: `drizzle/0028_policy_change_kinds.sql` (generated, then the header comment added)
- Test: `src/features/policy-changes/schema.test.ts` (create or extend), `src/server/db/constraints.int.test.ts` (extend), `src/server/policy-changes/snapshot.int.test.ts` (create)

**Interfaces:**
- Produces in `request.ts`:
  - `{ kind: "car_replaced"; catalogueVariantId: string; registration: string | null; currentMileage: number }`
  - `{ kind: "home_contents"; contentsValuePence: number; valuablesPence: number }`
  - `{ kind: "home_security"; lockType: LockType; windowLocks: WindowLockType; alarmType: AlarmType; hasSmokeAlarm: boolean }` (types from `values.ts`)
  - `type CarChange = Extract<PolicyChangeRequest, { kind: "address" | "driver_added" | "driver_removed" | "car_replaced" }>`, `type HomeChange = Extract<PolicyChangeRequest, { kind: "home_contents" | "home_security" }>`. `cover` belongs to both.
- `schema.ts`: `car_replaced` validates `catalogueVariantId` as `z.uuid()`, `registration` with `normalisePlate` (null allowed), and `currentMileage` as the journey's (0–999,999 whole miles, its messages). `home_contents` validates pounds-to-pence with `contentsSchema`'s rules (contents £5,000–£500,000; valuables 0–500,000 and ≤ contents; `homeErrors` messages), sent as pence. `home_security` uses `z.enum` on the three value lists and `z.boolean()`.
- `values.ts`: `policyChangeKinds` gains `"car_replaced"`, `"home_contents"` and `"home_security"`.
- Produces in `policy-version-rows.ts`:
  - `PolicySnapshot` becomes `PolicySnapshotV1 | PolicySnapshotV2`. V2 is V1 with `snapshotVersion: 2` plus `vehicle: { make; model; year; variant; insuranceGroup; valuePence; catalogueVariantId: string | null } | null` and `property: { propertyType; contentsValuePence; valuablesPence: number | null; lockType; windowLocks: string | null; alarmType: string | null; hasSmokeAlarm: boolean } | null`.
  - `PolicyPersonal` gains `registration: string | null`.
  - `readSnapshot` always writes V2. For a home policy, `postcodeDistrict` comes from `properties.postcode_district` and `personal.address` from the `properties` address.
  - `latestVersion`'s return type is `PolicySnapshot`. Callers read only `money`, which both versions have.

- [ ] **Step 1: Write the failing tests.**
  - `schema.test.ts`:
    - "car_replaced normalises the registration and accepts null"
    - "car_replaced refuses a mileage over 999,999 with the journey's message"
    - "home_contents refuses valuables over contents with homeErrors.valuablesOverContents"
    - "home_security refuses an alarm type outside alarmTypes"
  - `constraints.int.test.ts`: "policy_changes accepts the 6.3c kinds".
  - `snapshot.int.test.ts`:
    - "a car snapshot is v2 with the vehicle and the registration only in personal"
    - "a home snapshot is v2 with the property, and its district and personal address are the insured home's": buy a home with a `properties.postcode` different from `customers.postcode`
    - "latestVersion reads a v1 row's money unchanged"
- [ ] **Step 2:** Run `vp test src/features/policy-changes/schema.test.ts src/server/db/constraints.int.test.ts src/server/policy-changes/snapshot.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `vp run db:generate` and rename the output to `0028_policy_change_kinds.sql`, updating `meta/_journal.json`. The migration only drops and re-adds `policy_changes_kind_check`. Add to the data contract's `policy_versions` notes: "From snapshot version 2 (6.3c) a snapshot has `vehicle` and `property`; a home's v1 `postcodeDistrict` is the customer's, v2's the insured home's."
- [ ] **Step 4:** Run the same tests, `vp test src/server/policy-changes src/server/data`, and `vp run db:check`. Expected: PASS and no drift.
- [ ] **Step 5:** Commit `feat(policy-changes): car and home change kinds, and snapshot version 2`.

---

### Task 2: Home policies load and price

**Files:**
- Modify: `src/server/data/policy-change-rows.ts` (`StoredPolicy`, `loadPolicyForChange`), `src/server/policy-changes/inputs.ts`, `src/server/policy-changes/price.ts`, `src/server/policy-changes/eligibility.ts`
- Test: `src/server/policy-changes/inputs.test.ts` (extend), `src/server/policy-changes/home-price.int.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's kinds.
- Produces in `policy-change-rows.ts`:
  - `type StoredPolicy = StoredCarPolicy | StoredHomePolicy`, each `StoredBase & { product: "car" } & PolicyRatingRows` or `StoredBase & { product: "home" } & HomeRatingRows`. `StoredBase` is today's non-rating fields (`policy`, `ratingVersionId`, `quote`, `customer`, `coverLevel`, `addons`, `voluntaryExcessPence`, instalment counts). A home has an empty `driverRelationships` and `driverNames`.
  - `loadPolicyForChange` returns null only for a missing policy or a product other than car or home.
- Produces in `inputs.ts`:
  - `interface HomeRatingRows { property: { postcode: string; propertyType: string; yearBuilt: number; bedrooms: number; rebuildCostPence: number; contentsValuePence: number; valuablesPence: number | null; hasAlarm: boolean; alarmType: string | null; windowLocks: string | null; hasSmokeAlarm: boolean; lockType: string; pastClaims: number; occupation: string | null } }`
  - `homeInputsFromPolicy(rows: HomeRatingRows, change?: HomeChange): HomeInputs`. `postcodeArea` comes from `property.postcode`; `occupation ?? ""`. A security change sets `hasAlarm = alarmType !== "none"`. Without one, it keeps the stored `has_alarm`.
- Produces in `price.ts`:
  - `priceSide` switches on `stored.product`. A `cover` change supplies the level and add-ons for either product, as it does for car today. Home calls `priceQuote([{ product: "home", inputs, tables, coverLevel, addons }])` with the same saving step.
  - `CarPrice` is renamed `ItemPrice`. `offeredAddons` and `coverLevelLines` work for both products.
- Produces in `eligibility.ts`:
  - `kindFits(product: "car" | "home", kind: PolicyChangeRequest["kind"]): boolean`. `cover` fits both; the others fit their own product.
  - `refusedChange` adds: a home `cover` with `voluntaryExcessPence !== 0` is refused, plus the `home_contents` and `home_security` cases (none refuse on their own; referrals come from pricing).
  - `changesNothing` adds: `home_contents` and `home_security` equal to the stored values. A stored null never equals a sent value.

- [ ] **Step 1: Write the failing tests.**
  - `inputs.test.ts`:
    - "homeInputsFromPolicy matches homeInputsFromJourney for the same answers"
    - "a security change sets hasAlarm from the alarm type"
    - "a contents change moves only contentsValuePence"
    - "a null occupation becomes an empty string"
  - `home-price.int.test.ts` (buy with `src/test/purchase.ts`):
    - "a home cover change prices on the bought rating version with home's add-ons"
    - "a contents value at refer_contents_pence_min is referred"
    - "a valuables-only change prices 'Your price stays the same'"
    - "a home bought on home v1 with no occupation prices without throwing"
    - "a home cover change with a voluntary excess is refused"
    - "a car kind on a home policy, and a home kind on a car policy, are refused"
- [ ] **Step 2:** Run `vp test src/server/policy-changes`. Expected: FAIL.
- [ ] **Step 3:** Implement. Narrow on `stored.product` wherever the existing code reads `vehicle` or `drivers` (`apply.ts`'s audit and summary, `eligibility.ts`). The existing 6.3b tests must pass unchanged.
- [ ] **Step 4:** Run `vp test src/server/policy-changes src/server/data`. Expected: PASS, including every 6.3b test.
- [ ] **Step 5:** Commit `feat(policy-changes): load and price a home policy for a change`.

---

### Task 3: Change car: resolving and pricing the new car

**Files:**
- Create: `src/server/policy-changes/resolve.ts`
- Modify: `src/server/data/policy-change-rows.ts` (`catalogueCar`), `src/server/policy-changes/inputs.ts`, `src/server/policy-changes/price.ts`, `src/server/policy-changes/eligibility.ts`
- Test: `src/server/policy-changes/car-change.int.test.ts` (create)

**Interfaces:**
- Consumes: `findDemoPlate` (`#/features/quote/demo-plates`, already pure and shared).
- Produces in `policy-change-rows.ts`: `catalogueCar(tx: Tx, by: { id: string } | { make: string; model: string; year: number; variant: string }): Promise<CatalogueCar | null>`. It reads `vehicle_catalogue` where `is_active`. `CatalogueCar = { id; make; model; year; variant; fuelType; doors; insuranceGroup; valuePence }`.
- Produces in `resolve.ts`:
  - `type ResolvedChange = Exclude<PolicyChangeRequest, { kind: "car_replaced" }> | (Extract<PolicyChangeRequest, { kind: "car_replaced" }> & { car: CatalogueCar })`
  - `resolveChange(tx: Tx, change: PolicyChangeRequest): Promise<ResolvedChange | { refused: string }>`. For `car_replaced`, it reads the catalogue row by id; a missing or inactive row is refused. If `registration` isn't null, `findDemoPlate(registration)` must exist and its catalogue row's id must equal `catalogueVariantId`, or it's refused. Other kinds pass through.
- `priceChange`, `refusedChange`, `changesNothing` and `carInputsFromPolicy` take `ResolvedChange` from here on. `carInputsFromPolicy` with `car_replaced` takes the vehicle's year, group, fuel and value from `change.car`.
- `changesNothing`: `car_replaced` with `change.car.id === stored.vehicle.catalogueVariantId`. `StoredCarPolicy.vehicle` gains `catalogueVariantId`, `make`, `model` and `registration`.
- `priceChange`: for `car_replaced` only, a rating-table error on the **after** side (`Tables` throws "has no band") returns `{ outcome: "referred", reasonCode: null }`. Any other error still throws.

- [ ] **Step 1: Write the failing tests** in `car-change.int.test.ts`:
  - "a demo plate in any case and spacing resolves to its catalogue row"
  - "a demo plate sent with another variant's id is refused"
  - "an unknown registration is refused; a manual choice with registration null resolves"
  - "an inactive catalogue row is refused"
  - "the new car's group and value come from the catalogue, not the request" (the request carries only the id)
  - "a new car at refer_insurance_group_min is referred, and nothing is written"
  - "a new car the bought rating version has no band for is referred, not thrown"
  - "the policy's own variant is unchanged, whatever the plate or mileage"
- [ ] **Step 2:** Run `vp test src/server/policy-changes/car-change.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `vp test src/server/policy-changes`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): change car: the new car from the catalogue, checked against its plate`.

---

### Task 4: Applying, auditing, emailing and settling the new kinds

**Files:**
- Modify: `src/server/data/policy-change-rows.ts` (`applyChangeRows`), `src/server/policy-changes/apply.ts` (`auditEntry`, `summaryOf`, `headlineOf`), `src/server/policy-changes/writes.ts` and `src/server/policy-changes/settle.ts` (resolve before pricing: in `priceMyPolicyChange`, and again under the lock in `confirmMyPolicyChange` and `completeTopUp`; the stored request is re-resolved, never a saved catalogue row), `src/server/audit/actions.ts` (the three actions), `src/server/data/policies.ts` (`changesOf` eligible for `car` or `home`; `PolicyHome` gains `lockType`, `windowLocks`, `alarmType`, `hasSmokeAlarm`; `PolicyCar` gains `catalogueVariantId`)
- Test: `src/server/policy-changes/change.int.test.ts` (extend), `src/server/policy-changes/settle.int.test.ts` (extend), `src/server/audit/*.test.ts` (whatever lists the actions)

**Interfaces:**
- Consumes: `ResolvedChange` (Task 3), `StoredPolicy` (Task 2).
- `applyChangeRows`:
  - `car_replaced`: updates the `vehicles` row's `make`, `model`, `year`, `variant`, `fuelType`, `doors`, `insuranceGroup`, `valuePence`, `catalogueVariantId`, `registration` and `currentMileage`. It leaves `annualMileage`, `usage` and `overnightLocation`.
  - `home_contents`: `properties.contents_value_pence` and `valuables_pence`.
  - `home_security`: `lock_type`, `window_locks`, `alarm_type`, `has_smoke_alarm`, and `has_alarm = alarm_type !== "none"`.
- `changePolicy`'s signature is unchanged apart from `change: ResolvedChange`.

- [ ] **Step 1: Write the failing tests.**
  - `change.int.test.ts`:
    - "changing car updates the vehicle row, keeps mileage use and parking, writes v2 with the new vehicle, audits make, model, year and group without the registration"
    - "updating contents writes the property, version and audit, and queues the email with the contents line"
    - "updating security sets has_alarm from the alarm type and audits only the fields that moved"
    - "a security change on a home with a null alarm_type requires an alarm type and records from: null"
    - "a valuables-only change is applied at the same price"
    - "a home cover change updates the level and add-ons, leaving voluntary excess 0"
    - "the page offers Make a change on an active home and its detail carries the security fields"
  - `settle.int.test.ts`:
    - "home annual increase: top-up checkout, applied on checkout.session.completed"
    - "home annual decrease: refunded on the original payment intent"
    - "home monthly: the scheduled instalments and the subscription change"
    - "bundled home change: the shared subscription changes and the car's annual premium doesn't"
- [ ] **Step 2:** Run `vp test src/server/policy-changes src/server/audit`. Expected: FAIL.
- [ ] **Step 3:** Implement. The email's money in pounds uses `formatPounds(...).replace(".00", "")`, as 6.3b's excess line does.
- [ ] **Step 4:** Run `vp test src/server/policy-changes src/server/audit src/server/data src/server/payments`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): apply, audit and email car and home changes`.
- [ ] **Step 6: Checkpoint review.** Dispatch one reviewer (`model: sonnet`) on Tasks 1–4: the migration, snapshot v2, the product union and the plate check. Fix what it finds before Task 5.

---

### Task 5: The dialogs and the grids

**Files:**
- Create: `src/features/policy-changes/ChangeCarDialog.tsx`, `src/features/policy-changes/HomeDialogs.tsx` (Update contents and Update security)
- Modify: `src/features/policy-changes/ChangeDialogs.tsx` (`OpenDialog` gains `{ kind: "car_replaced" }`, `{ kind: "home_contents" }`, `{ kind: "home_security" }`; `ChangeCoverDialog` reads `coverCopy(policy.product)` and hides the excess Select for home), `src/features/account/PolicyDetailPage.tsx` (`MakeAChange` renders four car cards or three home cards per Global Constraints)
- Test: `src/features/policy-changes/policy-changes.browser.test.tsx` (extend), `src/features/account/policy-detail.browser.test.tsx` (the "nothing leads nowhere" test: home now shows its three cards; neither product shows Review renewal or Cancel policy)

**Interfaces:**
- Consumes: `PolicyDetail.car.catalogueVariantId`, `PolicyDetail.home` security fields (Task 4), and the existing `use-change-price` hook and `ChangeDialog` shell.
- Change car reuses the journey's `PlateBox` (with `showDemoPlates`) and `catalogueQuery` for the plate → catalogue match and the manual picker (`makesOf`, `modelsOf`, `yearsOf`). It has three states: found (02), not found (02b, Confirm disabled) and manual (02c). It prices once a car and a valid mileage are chosen, and shows "That's the car you're already insured for." for the current variant.
- Update contents prefills from `policy.home` (pounds). Update security prefills, leaving a null field empty (placeholder "Choose"), and prices once every field is answered.

- [ ] **Step 1: Write the failing tests** in `policy-changes.browser.test.tsx`:
  - "a car policy shows four cards and a home policy three"
  - "Change car: a demo plate shows We found it and the mileage field; an unknown plate shows We couldn't find that car with Confirm disabled; Choose my car manually shows the four selects"
  - "Change car: the current car shows That's the car you're already insured for. and no Confirm"
  - "Update contents: valuables over contents shows the journey's message and no price"
  - "Update security: a null alarm type opens empty and the price waits for it"
  - "home Change cover: home's level names and add-ons, and no Voluntary excess select"
- [ ] **Step 2:** Run `vp test src/features/policy-changes src/features/account` (`vp dev` stopped). Expected: FAIL.
- [ ] **Step 3:** Implement to the frames. Load the new dialogs lazily, as 6.3b's are (its build note).
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(policy-changes): Change car, and Make a change on home policies`.

---

### Task 6: E2E and axe

**Files:**
- Modify: `e2e/policy-changes.spec.ts`

- [ ] **Step 1:** Add two tests:
  - "monthly car: change car by demo plate, see the price, confirm; the page title shows the new car"
  - "annual home: update security down, see the refund line, confirm; the toast shows"

  Add axe checks on Change car (all three states), Update contents, Update security and home Change cover at 390, 768 and 1440px.
- [ ] **Step 2:** Run `vp run db:test:up`, then the account specs' Playwright command with `vp dev` and `stripe listen` running (the local E2E recipe). Expected: PASS.
- [ ] **Step 3:** Commit `test(policy-changes): E2E for change car and a home security change, axe on the new dialogs`.

---

### Task 7: Done markers and the PR

- [ ] **Step 1:** Run `vp check`, `vp test` and `vp build` (`vp dev` stopped). Expected: all pass.
- [ ] **Step 2:** Final whole-branch review (`model: sonnet`). Fix the findings, and record what was kept or parked under the spec's "Notes from the build".
- [ ] **Step 3:** Done markers per `plan/git-workflow.md`:
  - the spec's Status
  - the 6.3c row in `phase.md`
  - the box in `build-plan.md`
- [ ] **Step 4:** Commit `docs(account): 6.3c done markers and build notes`, push, and open the PR into `staging`:
  - Title: the spec's commit message.
  - Body: the template sections, "Done when", and both trailers.
  - Damion runs the manual check locally with `stripe listen` (previews get no webhooks), including one annual home refund and one car change by plate.
