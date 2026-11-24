# 6.3b Policy changes

**Status:** done (#114; spec approved by Damion, 23 Nov 2026; preview checked by Damion, 24 Nov 2026)
**Phase:** 06-account-claims

## Goal

A car policyholder changes their policy from the policy page's "Make a change" section, without calling anyone:
- **Change address:** where they live, which is where the car is kept, and where it's parked overnight.
- **Add or remove a driver:** a named driver, such as a partner.
- **Change cover:** the cover level, the add-ons and the voluntary excess.

Each change re-prices the policy, shows the new price before Confirm, settles the difference in Stripe, and records the policy as it now stands in `policy_versions`.

**Why:** the policy page (6.2) shows the policy but can't change it, and a real policy changes during its year. Re-pricing and settling the difference was chosen over holding the price to renewal (Damion, 22 Nov 2026). Kerbie's "add my partner as a driver" (7.5) needs a server function to call, and this slice is that function. `policy_versions` also gives Phase 9 a history table: "what did my policy look like on 3 March".

## What exists already

- **Policy page** ([PolicyDetailPage.tsx](../../../src/features/account/PolicyDetailPage.tsx)): 6.2 hid "Make a change" and the Drivers card's "+ Add" until this slice (6.1's rule: nothing leads nowhere). `getMyPolicy` ([policies.ts](../../../src/server/data/policies.ts)) reads everything from the policy's **bought quote item**: `vehicles`, `drivers`, `properties`, the selected `quote_item_options` row and the selected `quote_item_addons`. The policyholder's address comes from `customers`. The certificate and schedule PDFs are built on download from the same reads ([src/server/documents](../../../src/server/documents)).
- **Where a car's address lives:** nowhere of its own. A car is rated on the customer's postcode area (`CarInputs.postcodeArea`), saved on `customers` and on `quotes.postcode`, plus `vehicles.overnight_location` (`garage`, `driveway`, `street`). A home policy's insured address is its own `properties` row.
- **`policies`:** `version` (default 1, never bumped yet), `cover_level` and `compulsory_excess_pence` (the page and list read the level from here), `annual_premium_pence` (the tier and add-ons less this policy's share of any saving, **before IPT**), `status` (`active`, `cancelled`, `lapsed`), `starts_on`, `ends_on`, `bundle_id`.
- **Money the page shows:** `getMyPolicy` and the schedule ([PolicyDocument.tsx](../../../src/server/documents)) derive the tier price from the selected `quote_item_options` row, add-on prices from `quote_item_addons`, the saving as tier + add-ons − `annual_premium_pence`, and "Total … including IPT" from `quotes.total_pence`. What the customer paid is `quotes.total_pence` (premium, IPT and fee, `quoteTotals` in [price-quote.ts](../../../src/features/rating/price-quote.ts)); a monthly instalment is `monthlyPayment(total, credit rate)` ([money.ts](../../../src/features/rating/money.ts)).
- **Rating:** `priceQuote()` ([price-quote.ts](../../../src/features/rating/price-quote.ts)) prices items from `CarInputs` and a rating version's tables. `getRatingTables(db, ratingVersionId)` loads any version. Each quote item keeps the `rating_version_id` it was priced on, and `monthlyPaymentFor` already uses the items' own versions, never the active one. **No code builds `CarInputs` from stored rows:** only `carInputsFromJourney`, from the browser's journey. This slice adds `carInputsFromPolicy`.
- **Payments (5.6b):**
  - **Annual:** a one-off Stripe Checkout payment (`mode: "payment"`, [checkout-params.ts](../../../src/server/payments/checkout-params.ts)). The card **isn't saved** for later charges. `payments` holds one row (instalment 1) with its `stripe_payment_intent_id`.
  - **Monthly:** a Stripe subscription with one inline `price_data` item. `payments` holds 12 rows, the future ones `scheduled`. The webhook ([webhook-handlers.ts](../../../src/server/payments/webhook-handlers.ts)) matches an invoice to its row by billing period and reads only the invoice's first line.
  - **Bundles (5.7b):** one quote, one subscription or payment, for both policies.
  - `payments` allows only instalment 1 on an annual plan and one row per quote and instalment number, so there's no room in it for a mid-term charge or refund.
  - `checkout.session.completed` runs `fulfilCheckout` in its own transaction, keyed on the `checkout_sessions` row.
- **Figma (Account · Policy `183:3502`, dialogs `183:3784`):** 03 Add a driver (`183:3955`), 04 Change address (`183:4072`), 05 Change cover (`183:4168`). Each one ends with a price line in an Alert ("Your price goes up by £7.10 a month", "goes down by £2.30 a month", "stays the same") and "The change applies from the date you choose. There's no admin fee.", then Back and "Confirm change". 02 Change car, 06 Review renewal and 07 Cancel policy are drawn too, but they're out of scope.
- **Staff:** no staff tool can see or change a policy, built or planned (6.8, 6.10–6.12).
- **Phase 9 data contract** ([data-contract.ts](../../../src/server/db/data-contract.ts)): `customers`, `quotes`, `quote_items`, `vehicles`, `drivers`, `quote_item_addons` and `policies` are copied as `mutable` tables on `updated_at`. `quote_item_options` and `quote_item_factors` are append-only.

## Decisions

1. **Car policy changes** (Damion, 23 Nov 2026): change address, add a driver, remove a driver, change cover (level, add-ons and voluntary excess).
   - **The rest of the six cards follow as their own slices** (Damion chose a run of slices so the demo has every drawn card working, 23 Nov 2026): **6.3c** Change car and home policy changes, **6.3d** Cancel policy, **6.3e** Renewal. Each builds on this slice's `changePolicy`, `policy_changes` and `policy_versions`.
   - Until 6.3c ships, a home policy shows no "Make a change" (6.1's rule), and a car policy shows only this slice's cards.
   - Moving house stays out of every slice: it's a new home quote, not a change.
2. **Where the policy's current details live** (Damion chose option A, 23 Nov 2026): a change **updates the bought quote item's detail rows in place**: `drivers`, `vehicles.overnight_location`, the selected option id and which add-ons are `selected`, `customers` and `quotes.postcode` for an address, and on `policies` the `cover_level`, `compulsory_excess_pence` and `annual_premium_pence`. The page, PDFs and Kerbie keep reading details where they read them today; **money** comes from the latest version (below).
   - Rejected: a new quote per change (policies, payments and bundles are all keyed to the bought quote, so it re-plumbs billing), and policy-owned copies of the details (rewrites the policy page, documents and purchase).
   - The history lives in `policy_versions` (decision 9). **Version 1 is the policy as sold.**
   - **Prices stay as sold on the quote; the current breakdown lives in the latest version.** *(my call, from the builder check)* `quote_item_options`, `quote_item_addons.annual_price_pence` and the `quotes` totals are never rewritten: they're what was quoted, and the options table is append-only in the data contract. Each `policy_versions` snapshot carries the policy's **money**: tier price, each selected add-on's price, the saving, IPT, the annual total and (monthly) the instalment. `getMyPolicy` and the schedule read every price from the latest snapshot. Details (drivers, car, address, cover level) still come from the rows above. Version 1's money is backfilled from today's rows, so nothing on the page moves for an unchanged policy.
3. **Changes apply from today, never a future date** (Damion, 23 Nov 2026). Under decision 2 a confirmed change is live at once. A future date would put a new driver on the certificate before their cover starts. The dialogs have no date field, and their note reads "The change applies from today. There's no admin fee."
4. **Re-pricing.** The difference is the policy re-priced **twice today on the rating version it was bought on**: once as it stands, once with the change. *(my call)*
   - `newAnnual = annual_premium_pence + (priceAfter − priceBefore)`, never below 1p.
   - Pricing "before" today as well means a driver turning 25 or the rates moving since purchase don't leak into the change. Only the change is charged for.
   - Both prices carry the policy's saving at its stored rate: the bundle discount for a bundle, the 8% multi-policy saving for an earned one. A policy that had no saving gets none now.
   - Both prices come from `carInputsFromPolicy` (the stored rows, ages and licence years worked out today), with the change applied for "after".
   - Outcome: if **either** price is **referred or declined** (a rule can now hit the policy as it stands), nothing changes. The dialog says "We can't make this change online." with no Confirm, and nothing is written except the `policy_changes` row (decision 8).
5. **What the customer pays: the part of the year that's left, with IPT.** `days left = ends_on − today` and `term days = ends_on − starts_on`. The difference in money is `diff = (newAnnual − oldAnnual) + IPT on it` at the policy's rating version's `ipt_rate`, as `quoteTotals` charges IPT. No fee. *(my call: pro-rata by day, no admin fee, as the frames say; IPT because it's what the customer paid)*
   - **Annual:** `due = round(diff × days left ÷ term days)`.
     - **More** (Damion chose option A, 23 Nov 2026): after Confirm the dialog shows an embedded Stripe Checkout for `due` on the customer's Stripe customer (`mode: "payment"`, one `price_data` line "Change to KRB-123456: added driver", tagged `kerb_env` and `policy_change_id`). The change is only applied when that payment succeeds (decision 7).
     - **Less:** applied at Confirm, and the difference is **refunded at once** to the policy's original payment intent. *(my call)* Refunds on one payment intent never total more than it took. If they would, the remainder goes to the latest top-up's payment intent.
     - **Zero:** applied at Confirm, no Stripe call.
   - **Monthly:** the difference for the rest of the year is **spread over the remaining scheduled instalments**. No one-off charge and no Stripe proration. *(my call: smoother than loading one month, which is what I first suggested in chat)*
     - Each remaining instalment becomes `old instalment + floor(diff × days left ÷ term days × (1 + credit rate) ÷ instalments left)`, the credit rate being the policy's own rating version's, as `monthlyPaymentFor` uses. Every remaining instalment is the same, because the subscription has one price; the pennies lost to rounding down are Kerb's. *(my call, from the builder check: no last-instalment adjustment, so Stripe and `payments` never drift)*
     - Confirm applies the change, updates the `scheduled` `payments` rows, and updates the subscription item's price to the new amount with `proration_behavior: "none"`, so the next invoice is the new amount and still has one line.
     - With no scheduled instalments left (the 12th has been taken), the change is applied at no charge and no refund. *(my call: under a month of cover left)*
   - **Bundles:** a bundle is one quote and one subscription or payment. The difference is the changed policy's alone, but it's charged on, refunded from or spread over the bundle's shared payment. The other policy's `annual_premium_pence` doesn't change.
6. **Who can make a change:** the policy is the signed-in customer's, `car`, `active`, and today is before `ends_on`. On a monthly plan, no instalment is `failed` (an unpaid month is 5.6b's lapse path). Otherwise "Make a change" isn't shown, and the server refuses with a reason the dialog can show.
7. **One open change per policy, and a version check.**
   - `policy_changes` allows one row per policy in `awaiting_payment`, enforced in Postgres (a partial unique index, like `checkout_sessions_one_open_per_quote`). A second dialog's Confirm while one is open finds the open one and offers to resume or abandon it. *(my call)*
   - Each change records the `policies.version` it was priced against. **Confirm** checks it under a row lock on the policy. **An annual top-up** checks it again when its payment lands (`checkout.session.completed` with `policy_change_id` in its metadata).
   - **Version moved on, top-up already paid:** the change goes to `failed`, nothing is applied, and the top-up is **refunded in full at once**. The customer sees "Your policy changed while you were paying, so we've refunded you. Please try again." on the policy page.
   - An abandoned or expired top-up checkout marks the change `abandoned`.
8. **`policy_changes`** (new table, one row per attempt that reached a price):
   - Columns: policy id and customer id (composite FK to `policies (id, customer_id)`), `kind` (`address`, `driver_added`, `driver_removed`, `cover`), `request jsonb` (what was asked, field by field), `from_version`, `to_version` (null until applied), `old_annual_pence`, `new_annual_pence`, `price_before_pence`, `price_after_pence`, `outcome` (`quoted`, `referred`, `declined`), the reason code when not quoted, `settlement` (`charge`, `refund`, `instalments`, `none`), `amount_pence` (the top-up, the refund, or the change to each instalment), `status` (`priced`, `awaiting_payment`, `applied`, `failed`, `abandoned`, `refused`), `failure_reason`, and the Stripe ids (`stripe_session_id`, `stripe_payment_intent_id`, `stripe_refund_id`, unique where set), with `created_at`, `applied_at` and `updated_at`.
   - The price breakdown goes on this row, not in `quote_item_options` or `quote_item_factors`, which stay as sold.
   - A referred change's row (`outcome = referred`, `status = refused`) is what 6.11 will queue (decision 13).
9. **`policy_versions`** (new table, append-only):
   - Columns: `policy_id`, `version` (unique together), `effective_from` (a timestamp), `policy_change_id` (null for version 1), and `snapshot jsonb`.
   - The snapshot holds everything the policy page shows: cover level, excesses, `annual_premium_pence`, add-ons, the drivers, `overnight_location` and the address. The schema is versioned in code, starting at `snapshotVersion: 1`.
   - **Version 1** is written for every existing policy by the migration (backfill from today's rows, which are still as sold), and by `purchase()` from now on.
   - Each applied change writes version `n + 1` and bumps `policies.version` in the same transaction as the row updates.
10. **The data contract changes on purpose** (Damion, 23 Nov 2026). After purchase, `quotes.postcode`, `quote_items.selected_option_id`, `vehicles`, `drivers`, `quote_item_addons.selected` and `customers` hold **the policy's current details**, not the quote as sold. Prices on the quote tables stay as quoted (decision 2), so the funnel's prices are untouched.
    - `policy_versions` and `policy_changes` join the contract as copied tables: `policy_versions` append-only on `created_at`, `policy_changes` mutable on `updated_at`.
    - Driver names and dates of birth inside snapshots and requests get the same treatment as the `drivers` columns.
    - [data-contract.ts](../../../src/server/db/data-contract.ts) and Phase 9's notes say "as sold is `policy_versions` version 1", so the quote funnel isn't quietly rewritten.
11. **Address change** (frame 04): New postcode → Address (the 5.3 postcode lookup, `addresses.ts`) → "Where is the car parked overnight?".
    - Updates `customers` (address lines, town, postcode) and the car quote's `quotes.postcode`, plus `vehicles.overnight_location`.
    - **Holds a home policy too:** before Confirm, the dialog shows "Your home insurance isn't changed. It still covers 18 Albion Road." It doesn't block the change. *(Damion agreed to warn, not block, 23 Nov 2026)*
    - **Holds another active car policy** (the dashboard never offers a second car, but the public quote journey can make one): the address change is refused online ("We can't make this change online."), since the shared `customers` address would move the other car's rating address without re-pricing it. *(my call)*
    - **A bundle** shares one `quotes.postcode` with the home item. A change to a bundled car leaves `quotes.postcode` alone. Car rating takes the postcode from `customers` (decision 4's inputs), and the home item is rated from its `properties` row. *(my call, for the builder to confirm in the code)*
    - Audit `policy.address_changed` (entity `policy`). Changes recorded as `{ postcode_area: { from, to }, overnight_location: { from, to } }`, never the full address.
12. **Add or remove a driver.** Adding follows frame 03: the fields the quote journey's named-driver step asks, with its validation (name, date of birth, relationship, licence type and licence date, occupation, employment status), laid out like the frame. The journey's claim questions are replaced by the frame's checkbox "They've had no claims or convictions in the last 5 years".
    - **Unticked:** "We can't add a driver with recent claims or convictions online." No price and no `policy_changes` row. *(my call: the journey's claim questions aren't drawn here)*
    - Up to the journey's limit of 4 named drivers. At the limit, "+ Add" isn't shown.
    - A `drivers` row is written with `is_main = false`, `no_claims_years` and `past_claims` 0.
    - Audit `policy.driver_added` with `{ relationship, licence_years }`, never the name.
    - "+ Add" on the Drivers card opens the same dialog.
    - **Remove a driver** (not drawn; built from frame 03's dialog pattern): each named driver on the Drivers card gets "Remove". It opens "Remove Arjun Patel from your policy?" with the price line (decision 14) and "Remove driver" / Back. The main driver has no "Remove". *(my call)* It deletes the `drivers` row (the version snapshot keeps them) and audits `policy.driver_removed` with `{ relationship }`, never the name.
13. **Change cover** (frame 05): all three levels (Essential, Comprehensive, Plus: the frame draws two), each with its price for the rest of the year as decision 5 words it, plus the car add-ons with their prices from the policy's rating version. The current choice is preselected.
    - A level the rating would refer can't be chosen ("Not available online").
    - **Voluntary excess:** a Select under the add-ons with the quote journey's excess choices, the current one preselected. It updates `policies.voluntary_excess_pence` and the item's `voluntary_excess_pence`, and is priced as `CarInputs.voluntaryExcessPence`. *(my call: one dialog for everything about the cover, so no new frame)*
    - Audit `policy.cover_changed` with `{ cover_level: { from, to }, addons: { added, removed }, voluntary_excess_pence: { from, to } }`. *(my call: the phase only names address and driver for audit; cover is a priced change too)*
14. **The dialogs' price line** follows the frames' Alert, worded for the plan:
    - **Monthly:** "Your price goes up by £4.60 a month", "goes down by £2.30 a month", "stays the same".
    - **Annual:** "You'll pay £38.40 now for the rest of the year", "We'll refund £21.10 to your card", "Your price stays the same".
    - The price comes from a read, `priceMyPolicyChange`, called as the form becomes complete. It writes the `priced` `policy_changes` row and returns its id. Confirm sends that id, and the server prices it again under the lock. If the price moved, it refuses with "The price has changed" and the new line.
15. **The server functions** live in `src/server/policy-changes/` with `defineWrite` and `withIdempotency`, are `signed_in`, and join the permission suite:
    - `priceMyPolicyChange({ reference, change })`.
    - `confirmMyPolicyChange({ changeId, idempotencyKey })`: returns `applied`, `pay` (client secret) or `refused`.
    - `abandonMyPolicyChange({ changeId })`.
    - The core is `changePolicy(tx, policyId, change, actor)`, which Kerbie 7.5 must call. A Kerbie action never gets its own pricing or writes.
    - Rate limit: 30 prices per policy per hour. *(my call)*
16. **After a change:** the page reloads its data: the stat cards, the Drivers card and a toast "Your policy's been updated".
    - A `policy_changed` email is queued as a job: what changed, the new price and payment, and a link to the policy page for the updated certificate and schedule. *(my call: insurers send updated documents, and the PDFs already rebuild from current rows)*
    - The page caches stay `private, no-store`.
17. **6.11 gets a line**, not code: "Referred policy changes (6.3b's `policy_changes` with `outcome = referred`) join the queue: approve re-prices with the loading and offers the customer a Confirm." *(Damion, 23 Nov 2026: option 1 now, 2 later)*

## In scope

- "Make a change" (three cards: Add a driver, Change address, Change cover) and the Drivers card's "+ Add" and "Remove" on car policy pages; dialogs 03, 04 and 05 adapted per decisions 3, 12, 13 and 14, and the Remove driver dialog
- `policy_changes` and `policy_versions` with their migration (including the version-1 backfill, written so it can't collide with rows a preview or local E2E made first, as 0018 taught), `purchase()` writing version 1
- `priceMyPolicyChange`, `confirmMyPolicyChange`, `abandonMyPolicyChange` and `changePolicy`, in the permission suite
- Settlement: annual top-up checkout and its webhook path, refunds, monthly instalment and subscription updates
- Audit actions `policy.address_changed`, `policy.driver_added`, `policy.driver_removed`, `policy.cover_changed`; the `policy_changed` email
- Data contract entries for the two new tables and the note that the quote tables hold current details after purchase

## Out of scope

- Change car and home policy changes (6.3c), Cancel policy (6.3d), Review renewal (6.3e)
- Moving house
- Future-dated changes
- Staff handling of referred changes (6.11)
- Saving annual cards for later charges
- Mobile and tablet frames: the dialogs adapt the web frames, as 6.2 did

## Tests

| Layer | What |
|---|---|
| Unit | Removing a driver and changing the excess price through the same before/after path. Pro-rata: annual charge and refund, monthly spread over 1–11 instalments with the credit charge and the rounding on the last; day counts across a leap year; zero difference; no instalments left. Price line wording for each plan and direction. The snapshot builder's shape |
| Integration | `changePolicy` for each kind: rows updated, `policy_versions` n+1 written, `policies.version` bumped, audit row without names or full addresses, in one transaction. Price before and after on the bought rating version, so a policy bought under v1 re-prices on v1; a driver's birthday since purchase doesn't move the price. Referred/declined after: nothing applied. Refused for another customer's, home, lapsed, cancelled, ended or failed-instalment policies. Stale version at Confirm refused. Second open change refused by Postgres. Idempotent Confirm applies once |
| Integration (Stripe fake) | Annual increase: checkout made with `policy_change_id`; `checkout.session.completed` applies it once (delivered twice); version moved before payment → `failed` and a full refund; expired session → `abandoned`. Annual decrease: refund on the original payment intent, capped and spilling to a top-up's. Monthly: scheduled rows and the subscription item updated with `proration_behavior: "none"`; the next invoice still matches its row by period. Bundle: the shared payment changes, the other policy's premium doesn't |
| Integration | Migration backfills version 1 for every existing policy; a new purchase writes version 1. Data contract lists both tables (the contract's own test) |
| Component | Make a change shown only on eligible car policies; each dialog's fields, price line (monthly and annual, up/down/same), the "can't make this change online" state, the home-policy warning, the unticked-checkbox message, the open-change resume, "Not available online" on a referred level |
| E2E | Monthly customer adds a driver → sees the price go up → confirms → the Drivers card and Per month update. Annual customer changes cover up → pays the top-up in embedded Checkout (Stripe test card) → the policy shows the new cover. axe on the dialogs at 390, 768 and 1440px |

## Done when

- A car policyholder can change their address, add a driver and change cover, sees the new price first, and pays or is refunded the difference.
- Every applied change has a `policy_versions` row and a bumped `version`; existing policies have version 1.
- The tests above pass in `ci`.
- Preview manual check by Damion, including one annual top-up paid with a Stripe test card.

## Notes from the build

- **Database access lives in `src/server/data/`** (the lint rule): `policy-version-rows.ts` (snapshot, `writeVersion`, `latestVersion`) and `policy-change-rows.ts`. Both are row helpers, left out of the permission suite like `checkout-rows.ts`. The logic is in `src/server/policy-changes/` (`inputs`, `price`, `eligibility`, `apply`, `settle`, `writes`).
- **Versions keep personal data apart:** `policy_versions.snapshot` (copied) and `.personal` (names, dates of birth, address; `drop`). Drivers in the snapshot carry their age on the version's day, not an age band, because the SQL backfill has to match the code exactly.
- **`ends_on` is the last day of cover**, so the pro-rata counts include it, and today too. 0027's backfill works ages out the way `ageOn` does (29 February birthdays fall on 28 February in a common year). Postgres's `age()` doesn't. Checkpoint 1 found both.
- **Stripe retries are safe** (checkpoint 2):
  - Refunds carry `metadata.policy_change_id`, and a retry counts its own earlier refund as still available, so it repeats it under the same key.
  - The subscription is sent the database's new instalment as an absolute amount.
  - A top-up is applied only if what was paid is still that change's charge today. Otherwise it's refunded in full (`price_changed`).
- **A change that changes nothing** (the cover dialog opens on the current cover) prices as `unchanged`: the levels and add-ons, no row and no Confirm. An unpaid top-up shows "You started a change and haven't paid for it yet." with **Cancel this change**. Closing the dialog after paying leaves the change waiting, so its webhook applies it (final review). Resuming an open top-up isn't built: it's cancel and confirm again.
- **The change dialogs load lazily.** Importing them eagerly pulled the quote journey's server functions into the policy page and broke its test page.
- **Seed:** version 1 for every seeded policy comes from 0027's backfill. Every 12th car policy has an abandoned price check. Applied changes aren't seeded yet.
- **Preview check (Damion, 24 Nov 2026)** found that a top-up paid on a preview never applied: a preview gets no webhook (staging's endpoint ignores preview-tagged events). The policy page now asks Stripe on load (`checkMyTopUp`) and applies a paid top-up through the webhook's own path, so a late webhook doesn't leave the customer waiting either. The same check rewrote the change email: past tense once an annual top-up or refund has happened, every part of a cover change named, and what changed in the subject.
- **Migration 0027 on `dev`:** applied 24 Nov 2026; all 1,399 policies got version 1, and none were missing after the merge, so no second backfill was needed.
- **Left for later** (final review minors):
  - A bundle's other policy keeps a stale instalment and total in its latest version after a car change.
  - The failed-top-up notice doesn't vary by reason.
  - A paid, orphaned top-up session (its confirm rolled back) isn't refunded automatically.
  - Snapshot ages are exact years.

## Commit message

`feat: change your address, add or remove a driver, or change your cover and excess from your policy page, with the new price shown first and the difference paid or refunded`

## Sources

- The 6.3b row in [phase.md](phase.md) and its testing row ("A policy change writes a `policy_versions` row and bumps `version`")
- 6.3's decision 1 in [03-settings.md](03-settings.md)
- Figma Account · Policy `183:3502`: dialogs `183:3784` (03 `183:3955`, 04 `183:4072`, 05 `183:4168`)
- 5.6b Stripe payments (checkout, webhook, subscriptions), 5.7b bundles, 6.1b multi-policy saving, 6.2 [02-policy-detail.md](02-policy-detail.md)
