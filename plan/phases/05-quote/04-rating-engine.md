# 5.4 Rating engine

**Status:** done (merged as #87; `dev` reseeded 12 Nov 2026). Plan in [04-rating-engine-plan.md](04-rating-engine-plan.md)
**Phase:** 05-quote

## Goal

The calculator behind every price Kerb shows. `priceQuote()` takes what the quote journey collected and returns, for each product on the quote: a price for each cover level and each add-on, the factor lines behind it, and an outcome (quoted, referred or declined) with a reason code. Every number comes from the versioned rating tables written in 4.8; the code holds only the formulas and the rule types. Car, home and business are all priced and tested, though only the car journey has screens so far.

- **The video shot:** 5.3's holding view now shows the car price. Add a 19-year-old named driver on screen 12a and the price rises; remove them and it drops back.
- **Shown, not saved** (Damion, 11 Nov 2026). The price is worked out on the server and shown in the tab. Nothing personal reaches the database until the visitor signs in at 5.6. The code that saves a priced quote is built and tested here, and 5.6 calls it.
- **The stand-in goes.** The seed's `scripts/seed/pricer.ts` (4.9) is replaced by `priceQuote()`, and `dev` is reseeded.

## Decisions

1. **Paying monthly costs 10% more** (Damion, 11 Nov 2026), as 4.8 call 15 set (`monthly_credit_charge_rate = 0.10`). Screen 13 (`226:699`) draws monthly as annual ÷ 12 with the footnote "Monthly totals shown are 12 payments"; those figures and the footnote are out of date. 5.5 builds the screen with the right monthly figures, and Figma is updated to match.
2. **No quote is saved in 5.4** (Damion, 11 Nov 2026).
   - **Why:** `quotes.customer_id` is required (4.2), and guests only sign in at 5.6. Saving earlier would mean customer rows for anonymous visitors, or loosening that rule. Most visitors who check a price never buy, so their details stay in their own tab.
   - **What 5.4 still builds:** `saveQuote()`, which writes in one transaction:
     - the quote with its breakdown totals, a reference and `valid_until` 30 days on, as the seed does *(my call)*;
     - each item with its `rating_version_id`, outcome, reason and `start_date` (a parameter: 5.5 asks for the start date, so the caller passes it);
     - its options, add-ons and factor lines, and its detail rows (`vehicles`, `drivers` for a car, `properties` for home, `businesses` for business);
     - the first `underwriting_decisions` row per item.

     It's covered by integration tests against a test customer. 5.6 calls it after sign-in and adds its idempotency key and rate limit.
   - **References:** `saveQuote()` draws `KRB-Q-NNNNN` at random **below** the seed's 9 range (10000–89999), retrying on a unique clash (4.9 call 19).
   - **The selected tier** until 5.5 adds a choice: Comprehensive, so `selected_option_id` is always set *(my call)*.
   - **The cost:** a referred quote can't reach the staff queue (6.11) until it's saved in 5.6. Screen 19 already asks the visitor to continue.
3. **The price comes from the server.** The browser sends the journey's parts and the chosen `catalogueVariantId`; the server parses them with 5.3's schemas, reads the car's value and insurance group from the catalogue (they never leave the server, 5.2), prices it and returns the result. The rating tables never reach the browser.
   - **How it's called:** a server function (or `POST /api/quote/price`, the builder's choice, matching how 5.2 and 5.3 call the server). It's rate-limited per IP through `rate_limits` at 60 an hour, so the tables can't be scraped by brute force *(my call)*.
   - **Bad input** (a part that doesn't parse or no longer passes, an unknown or inactive car) returns no price, only the first step that fails (the car step for the car). The tab sends the visitor there, as 5.3's check does *(my call: a step is all the screen needs, and the step shows its own errors)*.
4. **What the holding view shows** (replacing 5.3's "Your price arrives in 5.4" slot):
   - **Quoted:** the Comprehensive price, annual and monthly ("£458.40 a year, or 12 payments of £42.02"), and "Premiums include Insurance Premium Tax". The answers summary and its "Edit" links stay.
   - **Referred:** screen 19's line, "We need to check a couple of things, usually within a day", and no price.
   - **Declined:** a neutral line ("We can't offer car cover for these details"), never the threshold that declined it.
   - **When a named driver is the reason** (decision 14), the line names them and offers the way out: "Unfortunately, we're unable to provide cover with Sam included as a named driver" (Damion's wording, 12 Nov 2026) or "We need to check a couple of things about Sam", then "Remove Sam to see a price without them". Still no threshold.
     - **Removing is on the spot** (found in the manual check, 12 Nov 2026; Damion left the design to me). The button takes Sam off the quote and prices it again, staying on "Your quote". A line says "Sam has been removed from this quote." with "Add Sam back", which restores him exactly as entered. If he was the only named driver, the answer goes back to No. Editing the named drivers stays under the summary's Edit link.
   - The full cover cards, comparison table, add-ons, breakdown and the designed referred and declined screens (13, 19, 20) are 5.5 *(my call: 5.4 shows the minimum that proves the engine works on screen)*.
   - **Changing an answer re-prices.** After an "Edit" and "Continue" back to the summary, the price is fetched again.
5. **From the journey to the rating inputs** *(my calls, all within what v1 already prices)*:
   - **Ages** are whole years on today's London date (5.3's date helpers). **Licence years** are whole years since the licence date. **No-claims years** as given (9 means 9 or more).
   - **Past claims:** the main driver's incidents in the last 5 years plus each named driver's claims count. Every driver's claims count, as UK insurers count them; v1's `past_claims` factor and its refer-at-3 rule (4.8 call 17) read the total.
   - **Named drivers:** v1 has one `named_driver_age` factor, and `quote_item_factors` holds one row per factor, so it rates the **youngest** named driver, the riskiest. No named drivers, no factor.
   - **Young-driver excess** (`young_driver_excess_pence`) is added when **any** driver is under 25.
   - **The driver rules check every driver** (decision 14).
   - **Postcode area:** the letters of the postcode's outward code (`SW1A 1AA` → `SW`). Jersey, Guernsey and the Isle of Man (`JE`, `GY`, `IM`) are **declined** with `outside_cover_area` (4.8 call 6). An area missing from the lookups is a config error, not a decline.
   - **Voluntary excess** is 0 until 5.5 lets the visitor choose one. **Cover level:** all three tiers are priced; the holding view shows Comprehensive.
   - **Vehicle age** counts from 4.8's valuation year (2026), as the stand-in does.
6. **The arithmetic** (phase row, 4.8 calls 14–16):
   - Factors are multiplied exactly; each line is rounded to whole pence **once**, at the end (half up).
   - Each tier's premium is clamped to the version's minimum. A chosen tier above the maximum is **referred** with `premium_above_max`, never silently capped. Both limits are before IPT.
   - **Fees:** `fee_pence` is added per item (0 in every v1).
   - **IPT** is `ipt_rate` × the rounded premium after any bundle discount, rounded once.
   - **Monthly, as the visitor sees it,** is 12 equal payments of (annual including IPT × 1.10) ÷ 12, rounded to the penny *(my call: the credit charge applies to the whole amount being spread, as a UK insurer's finance does)*.
     - **Stored columns keep their 4.2 meaning:** `quote_item_options.annual_premium_pence` and `monthly_premium_pence` are before IPT (monthly = annual × 1.10 ÷ 12), as the seed already writes them. No migration.
     - **The payment the visitor sees** comes from the stored quote total and the version's `monthly_credit_charge_rate` through one shared helper, `monthlyPayment(total, rate)`. That's a formula on saved figures, not a re-price (decision 11), so 5.5 and 5.6 show the same number the holding view showed.
   - **Breakdown lines sum to the total exactly,** for every product and the bundle. A test checks it.
7. **Bundle discount** (4.8 call 21 left the split to 5.4) *(my call)*:
   - 8% (`bundle_discount_rate`) applies only when a quote has both a car and a home item and **both are quoted**. A referred or declined item takes the discount away from the other.
   - It applies to the selected tiers' premiums, not to add-ons. It may take a premium below the product's minimum: the minimum is a pricing floor, the discount a commercial one *(my call)*.
   - The discount is worked out on the combined premium and rounded once, then split across the items in proportion to their premiums; the larger item takes any leftover penny so the split sums exactly.
   - Each item's IPT is on its premium after its share of the discount. The quote's `bundle_discount_pence` holds the total.
8. **Eligibility is separate pure functions**, one per product, beside `priceQuote()`. They read only the version's thresholds; the rule types are code, the numbers are data (4.8 call 17). Declines are checked before referrals and the first rule hit wins.
   - **Reason codes are a fixed list** in `values.ts`, kept by a check constraint on `quote_items.reason_code` and `underwriting_decisions.reason_code` (a migration). The list: the stand-in's codes (`vehicle_value_too_high`, `young_driver_high_group`, `high_insurance_group`, `high_vehicle_value`, `past_claims`, `new_licence_high_group`, `driver_age`, `rebuild_cost_too_high`, `high_rebuild_cost`, `high_contents_value`, `old_property`, `high_turnover`, `many_employees`, `high_risk_employees`), plus `premium_above_max` and `outside_cover_area`.
   - **No sensitive characteristics.** The rating input types have no field for sex, ethnicity, religion, health, disability or nationality, and a unit test fails if one is added.
   - Before the migration's index or constraint, existing rows are checked: the seed's reason codes are all in the list, so no dedupe is expected; the migration fails loudly rather than rewriting rows.
9. **The rating config is checked on load.** `getRatingTables()` (4.8, `src/server/data/reference.ts`) gains a check: 4.8's `validate.ts` runs on the version as read, before it's memoised, and a version that fails is refused: a missing parameter, a non-positive or missing multiplier, a factor the formulas don't know, or a band gap throws. Nothing ever defaults to 1.
   - **An unknown `rating_version`** (an id that isn't in the database) throws.
10. **Caching stays as 4.8 call 19 built it.** `getRatingTables()` already memoises each version by id, which can't go stale because a version never changes. `getActiveRatingVersion()` stays **uncached**, so activating a v2 takes effect at once. 5.4 reuses both and adds no cache.
11. **A saved quote keeps its price.** `saveQuote()` stores the version id on each item and the priced lines; reading a saved quote never re-prices it. A new version only affects new quotes.
12. **Calibration.** The tests price each of 4.8's ten example people (`calibration.ts`) and check they land in their target range or outcome. A miss is fixed with a v2 of that product's tables, never by editing v1 (4.8 call 22).
13. **Expected values are hand-worked.** Every test's expected figure has its working in a comment beside it, done from the v1 numbers, never copied from the code's output (phase row).
14. **The decline and referral rules check every driver** (Damion, 11 Nov 2026). A named driver is as much of a risk behind the wheel as the main driver, as UK insurers treat them.
   - **Which rules:** under 21 on group 30+ and under 25 on group 40+ (declined), a new licence on a high group (referred) and aged 80 or over (referred) run for the main driver and each named driver. The car's value and group rules are about the car, so they run once.
   - **Order:** every decline across all drivers before any referral; within each, the main driver first, then named drivers in the order entered. The first hit wins.
   - **Which driver:** the eligibility result carries `driver` (`main`, or the named driver's position). The reason codes don't change. When saved, `underwriting_decisions.note` records it ("named driver 2") for the 6.11 handler *(my call)*.
   - **The person applying is told** (Damion's example: a mum adds her son, and he's the reason). The holding view names the driver and offers to remove them on the spot, with Undo (decision 4).
   - **The video shot gets a second take:** the 19-year-old raises the price on the Golf (group 14), Fiesta (13), Corsa (13), Yaris (15) or BMW 320d (29, just under the line); on the Tesla (`TS24 EIV`, Model 3 RWD, group 32) the quote turns declined (under 21 on group 30+), naming him, and removing him brings the price back.
15. **The seed uses `priceQuote()`.** `scripts/seed/pricer.ts` and its test are removed; the seed calls `priceQuote()` and `saveQuote()`'s row builders. The seed's own references stay in its 9 range (`KRB-Q-9xxxx`, `KRB-9xxxxx`, `KRB-C-9xxxx`); the app's are drawn below it (decision 2, 4.9 call 19). `dev` is reseeded once the slice merges, and the result recorded here.

## In scope

- **The engine** in `src/features/rating/`, the folder `engineering.md` §4 and the phase's testing line put coverage thresholds on. Pure functions with no database access, imported only by server code, so the tables never reach the browser bundle:
  - `priceQuote()` and its per-product raters, the arithmetic helpers, the bundle split, `monthlyPayment()`.
  - The eligibility functions for car, home and business.
  - The journey-to-inputs mapping for car.
- **Server** in `src/server/data/reference.ts`: the on-load check in `getRatingTables()` (decision 9).
- **Server** in `src/server/quote/`: the price endpoint (decision 3) and `saveQuote()`.
- **Schema:** the reason-code list in `values.ts` and its check constraints (one migration).
- **Feature code:** `QuoteHolding` shows the price or outcome (decision 4); a price query that re-runs after an edit.
- **Seed:** `scripts/seed/` moves onto `priceQuote()`; the stand-in is deleted.
- **Docs:** `phase.md` and `build-plan.md` marked done with the slice; `figma.md` notes screen 13's monthly figures are out of date (decision 1).

## Out of scope

- **Screen 13 and the full breakdown,** add-ons, voluntary excess and cover choice; the designed referred and declined screens 19 and 20; the representative APR (5.5).
- **Saving the quote from the journey,** its idempotency key and rate limit, the sign-in gate (5.6).
- **The staff referral queue** and loadings (6.11).
- **Home screens** (5.7). Business has no journey; it's priced in tests only.
- **A car v2** unless a calibration person misses (decision 12).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | `priceQuote()`, table-driven for car, home and business: base rate × factors, tier multipliers, rounding once per line, minimum premium, above-maximum referred, fees, IPT on the rounded premium, monthly with the 10% charge; breakdown lines sum to the total; unknown `rating_version` throws. Each expected value worked by hand in a comment | yes |
| Unit | Bundle: 8% only when car and home are both quoted; split in proportion with the leftover penny on the larger item; sums exactly; IPT after the discount; no discount with a referred or declined item | yes |
| Unit | Eligibility: each rule's boundary (one below, on, one above) for car, home and business; declines before referrals; Crown dependencies declined; the driver rules fire for a named driver and report which one, a named driver's decline beats the main driver's referral, and the first named driver hit is the one reported; the input types have no sensitive-characteristic field | yes |
| Unit | Config on load: a missing parameter, a zero or negative multiplier, an unknown factor and a band gap each throw | yes |
| Unit | Journey to inputs: ages and licence years on the London date (including the day before and on a birthday); past claims sum across drivers; youngest named driver rated; young-driver excess when any driver is under 25 | yes |
| Unit | Calibration: each of 4.8's ten people lands in its target range or outcome | yes |
| Integration | `saveQuote()`: a saved quote stores its breakdown, factor lines, totals and `rating_version_id`, and writes one `underwriting_decisions` row per item, in one transaction (a failure part-way leaves nothing); reading it after a new version is added still shows the old price; a reason code outside the list is refused by the database | yes |
| Integration | The price endpoint: a valid journey returns a price and no table data; a bad part returns the validation-error shape; an inactive car is refused; the rate limit holds | yes |
| Component | In real Chromium: the holding view shows the Comprehensive price; adding a 19-year-old named driver raises it and removing them brings it back; a referred journey shows the referral line and no price; a named driver who declines the quote is named, and "Remove" opens the named-drivers step and the price returns once they're gone | yes |
| E2E | 5.3's driver-steps journey now ends on a price; axe on the holding view at phone and desktop width | yes |
| Manual | On staging at phone width and on a laptop: a demo plate journey shows a sensible price; the named-driver shot works; `dev` reseeded and the seeded quotes look right | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR. Locally (12 Nov 2026): `vp check` clean, `vp test` 130 files and 1,707 tests, `vp build`. The E2E (the Golf's price, the Tesla's decline naming the driver, axe on the quote view) runs on the PR's preview.
- [x] The manual check passes, with the results recorded here. Damion, 12 Nov 2026, on the PR preview:
  - **A sensible price:** a 44-year-old in E8 with 3 years' no-claims and 12,000 miles gets £967.18 a year, or 12 payments of £88.66 (£967.18 × 1.10 ÷ 12).
  - **The named-driver shot:** adding John, 20 (17–20 band), raises the price by exactly ×1.35, checked against the engine; removing him brings it back. A first comparison looked off by ×0.95 because another answer had changed between the two quotes; re-pricing confirmed the engine.
  - **The Tesla (`TS24 EIV`, group 32):** with John named it showed the decline naming him and no price; without him, £1,526.88 a year, or 12 payments of £139.96. Damion reworded the decline afterwards (decision 4).
  - **Found and fixed:** "Remove John" only opened the named-drivers step with John still there. It now removes him on the spot, prices again, and offers "Add John back" (decision 4). The button also sizes to its text.
  - **Remove and Undo, after the fix:** on the Tesla with John named, "Remove John" stayed on "Your quote" and showed "John has been removed from this quote. Add John back" above £1,703.39 a year, or 12 payments of £156.14 (£1,703.39 × 1.10 ÷ 12); "Add John back" brought the decline back. Checked again at phone width.
  - **Phone width (393 px):** nothing clipped or overflowing. The price sentence wraps over three lines in the 30 px price style; 5.5 puts the monthly figure on its own smaller line, as screen 13 does.
  - **`dev` reseeded after the merge** (12 Nov 2026, `vp run db:reset-dev -- --confirm <dev host>`, which migrates, loads the reference data and seeds in one run): 0020 applied, car, home and business v1 active, 5,524 quotes and 5,461 items, and every app-role check passed. Spot check, read-only:
    - **Prices, quoted one-item quotes with IPT:** car £252.00 to £6,432.12, median £621.73 (the lowest is the £225 minimum plus IPT); home £140.52 to £2,694.47, median £506.52; business £61.60 to £20,733.04, median £461.82. All within each version's limits.
    - **Bundles:** 544 quotes have a discount, and none without a quoted car and a quoted home (decision 7).
    - **Reasons:** all on the fixed list; the most common are `high_insurance_group` (89), `past_claims` (57) and `young_driver_high_group` (46). 21 decisions note "named driver 1" (decision 14).
    - **References:** `KRB-Q-90000` to `KRB-Q-95523`, the seed's 9 range.

## Commit message

`feat: the rating engine, priceQuote() for car, home and business from the versioned tables, with eligibility, the bundle discount and the car price on the quote page`

## Sources

- **Plan:** phase.md, the 5.4 row and its testing rows.
- **Figma:** screen 13 (`226:699`) for the price lines, 19 (`226:789`), 20 (`226:804`) and 21 (`230:1434`) for the outcomes and the bundle.
- **Earlier slices:**
  - 4.2: `quotes`, `quote_items`, `quote_item_options`, `quote_item_addons`, `quote_item_factors`, `underwriting_decisions` and the total check.
  - 4.8: the rating tables v1, calls 6, 9, 14–17, 21 and 22; `calibration.ts`, `validate.ts`.
  - 4.9: the stand-in pricer and the seed's reference ranges (call 19).
  - 5.2: the catalogue stays on the server. 5.3: the journey parts, their schemas and the holding view.
- **Damion, 11 Nov 2026:** monthly costs 10% more; price shown, not saved, until 5.6; screen 13 looks right; the driver rules check every driver, and the person applying is told which one.
