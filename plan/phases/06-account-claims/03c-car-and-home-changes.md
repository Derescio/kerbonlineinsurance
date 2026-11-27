# 6.3c Change car and home policy changes

**Status:** done (spec approved by Damion, 25 Nov 2026; E2E passed on `dev`, 26 Nov 2026; Damion's manual check pending)
**Phase:** 06-account-claims

## Goal

Every drawn "Make a change" card works in the demo, apart from Review renewal (6.3e) and Cancel policy (6.3d):
- **Change car** on a car policy: a new registration through the plate lookup, or the car chosen from the catalogue when the lookup doesn't know it.
- **A home policy's own "Make a change":** Change cover (level and add-ons), Update contents (contents value and valuables) and Update security (door lock, window locks, burglar alarm, smoke alarms).

Each change goes through 6.3b's `changePolicy`. It's re-priced, the new price is shown before Confirm, the difference is settled in Stripe the same way, and a `policy_versions` row and an audit row are written.

**Why:** Damion added 6.3c on 23 Nov 2026 so the demo has every drawn card working. A home policy has no "Make a change" at all yet. Kerbie (7.5) makes changes only through `changePolicy`, so each change built here is one Kerbie can make.

## What exists already

- **6.3b** ([03b-policy-changes.md](03b-policy-changes.md)) built the whole change path for car: `PolicyChangeRequest` ([request.ts](../../../src/features/policy-changes/request.ts)), `carInputsFromPolicy` ([inputs.ts](../../../src/server/policy-changes/inputs.ts)), `priceSide` and the settlement maths ([price.ts](../../../src/server/policy-changes/price.ts)), eligibility ([eligibility.ts](../../../src/server/policy-changes/eligibility.ts)), `changePolicy` with its audit and email ([apply.ts](../../../src/server/policy-changes/apply.ts)), Stripe settlement ([settle.ts](../../../src/server/policy-changes/settle.ts)) and the three server functions ([writes.ts](../../../src/server/policy-changes/writes.ts)). The dialogs share `ChangeDialog.tsx`, whose price line is `success` (green) for a refund or lower price and `info` (blue) otherwise. Frame 10 draws it that way.
- **Car only, today:** `loadPolicyForChange` ([policy-change-rows.ts](../../../src/server/data/policy-change-rows.ts)) returns null for anything but car. `policy_changes.kind` is checked in Postgres against `policyChangeKinds` (`address`, `driver_added`, `driver_removed`, `cover`) in [values.ts](../../../src/server/db/schema/values.ts).
- **`policy_versions` snapshot** ([policy-version-rows.ts](../../../src/server/data/policy-version-rows.ts)): `snapshotVersion: 1` holds the cover, excesses, premium, money, drivers, `overnightLocation` and `postcodeDistrict`. It records neither the car (make, model, year) nor a home's details. `personal` holds driver names, dates of birth and the customer's address. Migration 0027's SQL backfill builds the same JSON, so the two must change together.
- **The car lookup is in the browser** ([VehicleStep.tsx](../../../src/features/quote/VehicleStep.tsx), [demo-plates.ts](../../../src/features/quote/demo-plates.ts)). Six made-up plates each point at a catalogue row. The catalogue comes from `GET /api/catalogue` (`catalogueQuery`). "We don't have that car" ([VehicleNotFound.tsx](../../../src/features/quote/VehicleNotFound.tsx)) offers "Choose my car manually": make, model, year and variant (`makesOf`, `modelsOf`, `yearsOf` in [catalogue.ts](../../../src/features/quote/catalogue.ts)). `vehicles` copies the catalogue fields at quote time, with `catalogue_variant_id`, `registration` (nullable) and `current_mileage` (not null).
- **Home rating:** `HomeInputs` ([types.ts](../../../src/features/rating/types.ts)) and `homeInputsFromJourney` ([home-journey.ts](../../../src/features/rating/home-journey.ts)). Rated: postcode area, property type, year built, bedrooms, rebuild cost, contents value, `hasAlarm` (alarm isn't "none"), `hasSmokeAlarm`, lock type, past claims, occupation (home v2 only). **Stored but not rated:** valuables, window locks and the kind of alarm (5.7, decision 10). Home has **no voluntary excess**. `homeEligibility` ([eligibility.ts](../../../src/features/rating/eligibility.ts)) refers a high contents value (`refer_contents_pence_min`) among others.
- **Car eligibility** refers a high insurance group, a high vehicle value, and a new licence with a high group.
- **Figma (Account · Web `177:2850`, Account · Policy `183:3502`):** 02 Change car (`183:3785`, the date field replaced by Current mileage on 25 Nov 2026), 02b Change car, not found (`282:3977`), 02c Change car, choose manually (`282:4033`), 08 Home policy, Make a change (`282:4089`), 09 Update contents (`282:4145`), 10 Update security (`282:4201`), 11 Change cover, home (`282:4257`). All drawn by Damion on 25 Nov 2026.

## Decisions

1. **One path for every change** (Damion chose approach A, 25 Nov 2026). The new changes are new kinds on 6.3b's `PolicyChangeRequest` and go through the same `priceMyPolicyChange`, `confirmMyPolicyChange`, `changePolicy` and settlement.
   - New kinds: `car_replaced`, `home_contents` and `home_security`. Home's Change cover is the existing `cover` kind.
   - `policyChangeKinds` and the `policy_changes_kind_check` constraint gain the three kinds in a migration.
   - Rejected: one loose `home_details` kind for contents and security (the audit and email couldn't say what changed, and Kerbie's input would need extra checks), and a separate home path (it would copy settlement, and 6.3b decision 15 says Kerbie never gets its own pricing).
2. **Everything else from 6.3b carries over unchanged:** today-only (decision 3), re-pricing twice on the bought rating version with the policy's saving (4), pro-rata settlement with IPT and no fee (5), one open change and the version check (7), the price line (14) and the page reload, toast and `policy_changed` email (16). So do the eligibility rules (6): `active`, before `ends_on`, no failed instalment. The rule "the policy is `car`" becomes "the policy is `car` or `home`, and the change's kind fits the product".
3. **Change car** (frames 02, 02b, 02c):
   - **Lookup:** the registration is matched against the demo plates in the browser, as in the quote journey. A match shows "We found it: {make} {model}, {year}" with its variant, fuel and transmission. No match shows 02b's "We couldn't find that car" with "Choose my car manually" and a disabled Confirm. 02c chooses make, model, year and variant from the catalogue, with "Look up by registration instead".
   - **Current mileage** is asked under the found car, or under the variant on 02c (hint "What the new car's odometer reads now."). Validated as the quote journey validates it.
   - **The request sends `catalogueVariantId`, the registration (null when chosen manually) and the current mileage.** The server reads the catalogue row for make, model, year, variant, fuel, doors, insurance group and value. It never trusts car details from the browser. *(my call: the same reason 5.3 checks the saved car matches the priced one)*
   - **The server checks the plate too** *(my call, from the builder check)*. A registration must be a demo plate (`findDemoPlate`, moved or re-exported so server code can import it) whose catalogue row is the sent `catalogueVariantId`; otherwise "We can't make this change online." A manual choice sends no registration and stores null. One shared function, `carFromPlate(registration)`, resolves a plate to its catalogue row for the browser, the server check and Kerbie (7.5), which has no browser.
   - **Kept from the old car:** annual mileage, usage and overnight location. *(my call, 25 Nov 2026; Damion didn't object)*
   - **The `vehicles` row is updated in place** (6.3b decision 2): every catalogue field, `catalogue_variant_id`, `registration` and `current_mileage`.
   - **Priced** through `carInputsFromPolicy` with the new car's year, group, fuel and value. A referral on the new car (high group, high value, new licence with a high group) gives "We can't make this change online." as in 6.3b.
   - **The same car isn't a change:** choosing the policy's current catalogue variant prices as `unchanged` (no row, no Confirm), whatever the plate or mileage, as 6.3b's unchanged cover does. The dialog says "That's the car you're already insured for." *(my call, from the builder check: a plate transfer or a mileage reading alone isn't a change of car)*
   - **A car the policy's rating version can't price** (a value outside its tables) is refused with "We can't make this change online." rather than throwing. *(my call, from the builder check)*
   - **Audit `policy.car_changed`** with `{ make: { from, to }, model: { from, to }, year: { from, to }, insurance_group: { from, to } }`. Never the registration. *(my call: a car's make and model aren't personal; its plate is)*
   - **The page** reads the car from `vehicles`, so its title, plate badge, documents and the next certificate show the new car without further work.
4. **Home pricing.** `homeInputsFromPolicy(rows, today, change?)` sits beside `carInputsFromPolicy` and builds `HomeInputs` from the policy's `properties` row: its own postcode area (a home is rated on the insured address, not `customers`), property type, year built, bedrooms, rebuild cost, contents value, `has_alarm`, `has_smoke_alarm`, lock type, `past_claims` and occupation.
   - `priceSide` becomes product-aware: it prices the `home` item through `priceQuote` with the same saving rules. `offeredAddons` returns home's add-ons for a home policy.
   - **`hasAlarm` is stored, and so is `alarmType`.** A security change sets both: `has_alarm = alarm_type !== "none"`, as the journey does.
   - **Occupation:** a home row saved before 5.7c has none. It was bought on home v1, which doesn't rate occupation, so an empty occupation prices the same. *(builder to confirm in the code)*
5. **Update contents** (frame 09): total contents value and valuables total, with the journey's validation (valuables within the contents total).
   - Updates `properties.contents_value_pence` and `valuables_pence`.
   - A contents value at or over the referral threshold gives "We can't make this change online."
   - **A valuables-only change** isn't rated, so it prices as "Your price stays the same". It's still a change: Confirm writes a version, an audit row and the email. *(my call: the customer told us something true about their cover, and the schedule should show it)*
   - Audit `policy.contents_changed` with `{ contents_value_pence: { from, to }, valuables_pence: { from, to } }`.
6. **Update security** (frame 10): main external door lock, window locks, burglar alarm (the journey's options and labels) and "Smoke alarms are fitted and working".
   - Updates `properties.lock_type`, `window_locks`, `alarm_type`, `has_alarm` and `has_smoke_alarm`.
   - Window locks and the kind of alarm aren't rated, so changing only those prices as "stays the same", and it's still a change, as in decision 5.
   - Audit `policy.security_changed` with each field that moved as `{ from, to }`.
   - **Blank answers** *(my call, from the builder check)*: a `properties` row with no `alarm_type`, `window_locks` or `valuables_pence` (none in the seed or from the journey; only rows older than 5.7's questions could have them) opens that field empty, and it must be answered before the price is shown. A null `alarm_type` is never read as "none", so ticking smoke alarms can't quietly turn the alarm off. The audit's `from` is null.
7. **Home's Change cover** (frame 11): the three home levels with home's own wording (`coverCopy("home")`) and prices, and home's three add-ons. **No voluntary excess** (home has none). The request's `voluntaryExcessPence` is the stored 0, and the dialog doesn't show the Select. Audit `policy.cover_changed` as 6.3b, with `voluntary_excess_pence` unchanged.
8. **"Make a change" grids:**
   - **Car:** four cards: Change car, Add a driver, Change address, Change cover. Review renewal and Cancel policy wait for 6.3e and 6.3d (6.1's rule: nothing leads nowhere).
   - **Home:** three cards from frame 08: Change cover ("Cover level and add-ons"), Update contents ("What your belongings are worth"), Update security ("Locks and alarms"). Review renewal and Cancel policy wait the same way.
9. **Bundles:** a home change on a bundle is settled on the bundle's shared payment, exactly as a car change is (6.3b decision 5), and the car's premium doesn't move. 6.3b's address change already warns that it doesn't move the home. Nothing in this slice changes a home's address: moving house stays a new quote.
10. **Snapshot version 2.** `policy_versions.snapshot` gains:
    - `vehicle: { make, model, year, variant, insuranceGroup, valuePence, catalogueVariantId } | null`
    - `property: { propertyType, contentsValuePence, valuablesPence, lockType, windowLocks, alarmType, hasSmokeAlarm } | null`
    - and `snapshotVersion: 2`.
    - `personal` gains `registration` (null for home). A plate is personal, so it stays out of the copied snapshot.
    - **A home version's place is the insured home's** *(my call, from the builder check)*: `postcodeDistrict` comes from `properties.postcode_district` and `personal.address` holds the insured address, not where the customer lives. Version 1 took both from `customers`, which is wrong for a home insured away from the customer's address. v2 fixes it for new rows. Old rows are left as they are, and the data contract notes that a home's v1 district is the customer's.
    - Every version written from now on is version 2, including a purchase's version 1. Existing rows stay as they are: readers (`latestVersion` and the page's money) accept 1 or 2, and only money is read today, which both have. *(my call: no re-backfill of 1,399 rows on `dev` for fields nothing reads yet)*
    - The data contract notes the v2 fields. Driver and registration data stay in `personal` (`drop`).
11. **Email.** `summaryOf` and `headlineOf` cover the new kinds:
    - "Your car is now a Skoda Octavia (2021)." / "car changed"
    - "Your contents are now covered for £45,000, with valuables of £6,000." / "contents updated"
    - "Your home's security details are updated." with each changed item listed. / "security updated"
    - Home cover changes reuse 6.3b's cover wording.
12. **Kerbie (7.5):** nothing to build. The new kinds are on `changePolicy`, so 7.5's tools can call them. 7.5's spec decides which ones Kerbie offers.

## In scope

- Change car on car policies (frames 02, 02b, 02c), and "Make a change" on home policies (frame 08) with Update contents (09), Update security (10) and Change cover (11)
- The three new kinds on `PolicyChangeRequest` and their server schema; `homeInputsFromPolicy`; product-aware pricing, eligibility, `applyChangeRows`, audit and email
- Migration: `policy_changes_kind_check` widened
- Snapshot version 2 and its readers; the data contract note
- Car's "Make a change" grows to four cards; home's gets three

## Out of scope

- Review renewal (6.3e) and Cancel policy (6.3d), on both products
- Moving house, or changing a home's rebuild cost, bedrooms or property type
- A voluntary excess for home
- A real registration lookup (the demo plates stay the lookup)
- 6.3b's "left for later" list, including a bundle's other policy keeping a stale instalment in its latest version
- Re-backfilling existing versions as snapshot version 2
- Mobile and tablet frames: the dialogs adapt the web frames, as 6.2 and 6.3b did

## Tests

| Layer | What |
|---|---|
| Unit | `homeInputsFromPolicy` with each home change applied; `has_alarm` from the alarm type; an empty occupation on v1. `carInputsFromPolicy` with `car_replaced`. Snapshot v2's shape for car and home. Email lines and headlines for each new kind |
| Integration | `changePolicy` for `car_replaced`, `home_contents`, `home_security` and a home `cover`: rows updated, version n+1 written as snapshot v2, `policies.version` bumped, audit without the registration, all in one transaction. Change car takes make, value and group from the catalogue row, not the request. A referred new car or contents value: nothing applied. A valuables-only or window-locks-only change: priced "stays the same" and applied. A home kind on a car policy and a car kind on a home policy refused. The kind check accepts the new kinds. Readers accept v1 and v2 snapshots |
| Integration (Stripe fake) | A home annual change up (top-up) and down (refund); a home monthly change spread over instalments; a home change in a bundle settled on the shared payment, the car's premium unchanged |
| Component | Car grid's four cards; home grid's three; Change car's found, not-found and manual states, Confirm disabled until a car and mileage are chosen; Update contents' valuables check; Update security's fields; home Change cover with no excess Select |
| E2E | Monthly car customer changes car by demo plate → sees the price → confirms → the page title shows the new car. Annual home customer updates security → sees the refund line → confirms → the toast. axe on the new dialogs at 390, 768 and 1440px |

## Done when

- A car policyholder can change their car, by plate or from the catalogue, and a home policyholder can change their cover, contents and security, each seeing the new price first and paying or being refunded the difference.
- Every applied change writes a snapshot version 2 row.
- The tests above pass in `ci`.
- Preview manual check by Damion, run locally with `stripe listen` for the Stripe parts (previews get no webhooks).

## Notes from the build

- **Where the code is:** `resolve.ts` (the new car from the catalogue, checked against its demo plate) joins `src/server/policy-changes/`. `StoredPolicy` is now a car-or-home union in [policy-change-rows.ts](../../../src/server/data/policy-change-rows.ts), with `carPolicy()` and `homePolicy()` to narrow it. The dialogs are `ChangeCarDialog.tsx` and `HomeDialogs.tsx`, loaded lazily with the rest of `ChangeDialogs`.
- **Migration 0028** only widens `policy_changes_kind_check`. Damion applied it to `dev` on 26 Nov 2026.
- **Snapshot v2** is written for every version from this slice on. 0027's backfill test now compares against a v1 view of `readSnapshot`.
- **A 6.3b bug found on the E2E against real Stripe:** a monthly change that moved the instalment failed at Confirm. Stripe makes the product behind Checkout's inline `price_data` inactive, and it refuses a new price on an inactive product. Each such change now creates its own active price (`prices.create`, product "Kerb monthly instalment, {reference}") and points the subscription item at it. The Stripe fake gains `prices.create`. 6.3b's E2E hadn't hit it because its add-driver change didn't move the price.
- **Calls made in the build:**
  - A demo plate is stored as it's shown ("TS24 EIV").
  - "That's the car you're already insured for." is decided in the dialog, with the server's `unchanged` as the backstop.
  - Change car has no Find button. A demo plate matches as it's typed, "not found" waits for seven characters (and for the catalogue), and the demo plates are listed in the hint.
  - Home's Change cover keeps 6.3b's level descriptions (each level's price line).
  - The security email lists each changed answer: "Main door lock: …", "Window locks: …", "Burglar alarm: …", "Smoke alarms: …".
  - A car the bought rating version has no band for is refused by matching Tables' "has no band" error, on the after side of a change of car only. A test pins the wording.
- **Reviews:**
  - The checkpoint review (Tasks 1–4) found nothing critical or important.
  - The final review found two important problems, both fixed. Change car said a demo plate wasn't found while the catalogue was still loading. The home E2E's premise was wrong: going from an installed alarm to a monitored one doesn't move the price, so it now fits an alarm to a home that had none.
- **Left for later** (review minors):
  - A home rated on v2 with no stored occupation would show a pricing error, not "can't change online". None exist.
  - Change car's mileage field stays shown, and required, beside "That's the car you're already insured for."
  - A wrong plate shorter than seven characters is never flagged.
  - The home dialogs assume the policy has its home details.
  - The money and mileage boxes accept misplaced commas. The server re-checks.
  - Update contents opens valuables blank when never answered, with no "Enter 0 if none" hint.
  - A snapshot's `postcodeDistrict` is the customer's for a car and the insured home's for a home (v2 only). Phase 9 branches on `snapshotVersion`.
- **E2E on `dev`** (26 Nov 2026, `vp dev` with `stripe listen`) passed all four policy-changes tests. Local runs clear the 127.0.0.1 sign-up limit with Claude's allowed helper script.

## Commit message

`feat: change your car, or your home insurance's cover, contents and security, from your policy page, with the new price shown first and the difference paid or refunded`

## Sources

- The 6.3c row in [phase.md](phase.md)
- 6.3b's spec, [03b-policy-changes.md](03b-policy-changes.md), and its notes from the build
- Figma Account · Policy `183:3502` (02 `183:3785`) and Account · Web `177:2850` (02b `282:3977`, 02c `282:4033`, 08 `282:4089`, 09 `282:4145`, 10 `282:4201`, 11 `282:4257`)
- 5.2 and 5.3 (plate lookup and catalogue), 5.7 and 5.7c (home steps and home rating v2)
