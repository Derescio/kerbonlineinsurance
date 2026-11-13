# 5.5 Cover options + quote summary

**Status:** done (approved by Damion, 12 Nov 2026)
**Phase:** 05-quote

## Goal

After "Your quote is ready" (5.4b's R09), the visitor chooses their cover:
- **The cover level:** Essential, Comprehensive or Plus, compared side by side.
- **A voluntary excess.**
- **Any optional extras.**
- **How to pay,** annually or monthly.

They see exactly how the price is made up, then are offered home insurance alongside (screen 21). A quote that's referred or declined for a reason that isn't a named driver gets its own screen in place of 5.4's plain line. The bundle screens (03, 04 and screen 20's bundle half) are built and tested with sample home answers, ready for the home journey in 5.7.

- **The video shot:** pick Plus, raise the voluntary excess and watch every price drop, tick breakdown cover and watch the total and the breakdown change, then switch to monthly and see the cost of paying monthly and the APR.
- **Still nothing is saved** (Damion, 12 Nov 2026). The choice lives in the tab with the rest of the journey until the sign-in gate in 5.6, which saves the quote with `saveQuote()` (5.4). The `quote_item_options` and `quote_item_addons` rows in the phase row are written then, every tier and add-on with the choice marked.

## Decisions

1. **Designs.** Screens 13 (Choose cover, `226:699`), 19 (car referred, `226:789`), 20 (car declined, `226:804`), 21 (add home, `230:1434`), 03 (home referred, `222:6732`) and 04 (home declined in a bundle, `222:6747`), adapted to 5.4b's journey frame without being redrawn (5.4b, decision 3).
   - **Screen 13's monthly figures and footnote are out of date**: monthly costs 10% more (5.4, decision 1). This screen uses the real figures.
   - **Screens 19, 21 and 03 say the quote is saved.** That isn't true until 5.6, so the copy changes (decisions 9, 11 and 12).
   - **"Back to your quotes"** (19, 20, 03, 04) needs the account pages (Phase 6). It's left out until then.
   - **Screens 21 and 22 say "no bundle discount"**, but v1 keeps 8% (figma.md). Screen 21 shows the saving instead (decision 11).
2. **Where it sits.** Two new steps on `/quote/car`:
   - **`step=cover`, Choose cover.** The Stepper shows step 3, "Choose cover". R09's "Choose cover" opens it, replacing 5.4b's holding line "Choosing your cover arrives in 5.5".
   - **`step=add-home`, screen 21.** Choose cover's "Continue with {tier}" opens it. The Stepper stays on "Choose cover" *(my call: the cover is chosen, and Buy hasn't started)*.
   - **Guarding them:** only a quoted journey can reach either step. A direct link on a journey that isn't quoted goes to `step=quote`, replacing the history entry. A journey with an unfinished step goes to that step, as 5.3's check does. After a refresh, the step shows "Working out your price…" until the price arrives, then applies the guard.
   - **Leaving them:** Choose cover's "Back to your quote" returns to R09. Screen 21's "Back to car quote" returns to Choose cover.
3. **What's kept in the tab:**
   - **A new optional journey part,** `cover: { coverLevel, voluntaryExcessPence, addons }`. It starts at Comprehensive, £0 and no extras, and 5.6 saves it. A part that doesn't parse is dropped alone, as 5.3's parts are.
   - **The payment choice** stays 5.4b's `payment` part. **Choose cover shows the same annual and monthly cards** as R09 (Damion, 12 Nov 2026): both set the one value, so the card prices and the breakdown switch on the spot.
   - **Changing an earlier answer keeps `cover`.** The price is worked out again.
4. **Voluntary excess** *(my call; Damion deferred to me)*:
   - **The control:** a select, "Voluntary excess", offering £0, £100, £250, £500, £750 or £1,000. These are the lower edges of v1's `voluntary_excess` bands, so each choice is a different price. It starts at £0.
   - **Where it goes:** above the cover cards, because it changes every tier's price.
   - **Changing it prices again** on the server, since it's a rating factor. Each answer is cached in memory, so switching back is free.
   - **Total excess:** each tier's card and the table show the compulsory excess (the tier's, plus the young-driver excess when it applies) plus the voluntary excess, as "£500". The breakdown spells it out: "Total excess £500 (compulsory £250 + voluntary £250)".
5. **Optional extras** *(my call; Damion deferred to me)*:
   - **The checkboxes:** "Optional extras for {tier}", one per add-on the version offers, off at first. Car v1 has no per-tier add-on data, so both are offered on every tier:
     - "Breakdown cover", "24/7 roadside help anywhere in the UK".
     - "Motor legal protection", "Legal costs up to £100,000 after an accident that wasn't your fault".
   - **Labels and descriptions** live in the code, keyed by the add-on's name. A name the copy doesn't know shows the name, so nothing is ever hidden.
   - **Each add-on's price** is shown with IPT: "£50.40 a year" when paying annually, "£4.62 a month" when paying monthly.
   - **Ticking one** updates the total and the breakdown straight away, with no server call (decision 6). **Extras carry over** when the cover level changes.
6. **The price comes from the server once per excess** *(my call)*. 5.4's `priceCar` takes `{ journey, voluntaryExcessPence }` and returns everything the screen needs to compose any choice:
   - **per tier:** its outcome at that excess, its premium before IPT and its compulsory excess. Eligibility is the same for every tier, but `premium_above_max` can refer one tier and not another, so the server runs `priceQuote()` once per tier;
   - each add-on's annual price before IPT;
   - the version's `ipt_rate`, `fee_pence`, `monthly_credit_charge_rate` and `bundle_discount_rate`.

   **The quote's own outcome** is Comprehensive's, as in 5.4, and R09, R10 and screens 19 and 20 follow it. A tier that alone comes out referred shows on its card as "We'd need to check this level", with no price, and can't be chosen. If it was the chosen tier, the choice goes back to Comprehensive.

   **An excess amount that isn't offered** answers `{ status: "invalid", step: "cover" }`, and the tab resets `cover.voluntaryExcessPence` to £0.

   **Caching:** each excess's answer is cached in memory (React Query), not in the tab's storage. The query key is the journey without `lastPlate`, `payment` and `cover`, plus the excess. So choosing a tier, an extra or a payment never calls the server.

   The browser then adds up any choice of tier and extras with 5.4's own `quoteTotals()` and `monthlyPayment()`, so the money matches what 5.6 saves.
   - **What the tab sees:** prices and rates, which the screen shows anyway. The factor tables, factors and thresholds still never leave the server (5.4, decision 3).
   - **The rate limit** stays at 60 an hour. Ticking extras costs nothing, and changing the excess costs one call the first time.
7. **The price breakdown** *(my call; Damion deferred to me)* sits under the comparison on desktop and under the cards on a phone. For the chosen tier:

   | Line | Example |
   |---|---|
   | Comprehensive cover | £1,520.88 |
   | Breakdown cover (each extra chosen) | £45.00 |
   | Admin fees | No admin fees (`fee_pence` is 0; a fee shows its amount) |
   | Insurance Premium Tax (12%) | £187.91 |
   | **Total if you pay annually** | **£1,753.79** |

   **When paying monthly**, four lines follow:
   - **Cost of paying monthly (10%):** the total payable minus the annual total.
   - **Total payable:** 12 × the payment, as 5.4b, call 10 did.
   - **12 monthly payments of:** the payment.
   - **Representative APR:** see decision 8.

   **The rules for every line:**
   - Each line is a figure from `quoteTotals()`, and the lines add up to the total exactly (5.4, decision 6).
   - The bundle-discount line only appears on a bundle, so it's in 5.7.
8. **The representative APR** (4.8, call 15 left it to 5.5):
   - **When the payments fall** (Damion, 12 Nov 2026): **the first payment is taken when cover starts**, as UK insurers do, then one a month, 12 in all. 5.6 takes the first payment at Buy.
   - **What it measures:** the annual percentage rate of charge on paying monthly. The amount of credit is the annual total, repaid by the 12 payments at 0, 1, … 11 months, using the UK consumer credit formula (CONC App 1.1): monthly compounding to an annual rate, rounded to one decimal place.
   - **Where it's worked out:** a pure function, `representativeApr(totalPence, paymentPence)`, so it's exact for each quote.
   - **What it comes to:** the 10% charge gives **23.6%** (23.61% before rounding). On a very small total the rounded payment can move it to 23.7%. The unit test checks it against a hand calculation.
   - **The label:** "Representative APR 23.6%". No credit is really offered (the site's notice bar says so).
9. **Car referred for a reason other than a named driver** (screen 19, adapted). This replaces 5.4's plain line on R09.
   - **The badge, heading and intro:** "Under review", then "We need to check a couple of things…" and "We need to review your answers before we can confirm whether we can offer car cover."
   - **The card** shows the car and the main driver's name, as drawn. Its heading is "What happens next?", because nothing is saved yet. Its copy: "Our team checks referred quotes, usually within a day. Sign in and we'll send your quote for checking: you won't need to start again." Then, as drawn: "You can't buy this policy while it's under review. No car cover is in place yet."
   - **Buttons:** "Sign in to send this for review" (Damion, 12 Nov 2026) and "Check your answers", which opens Your details at About you.
     - **Until 5.6 merges,** "Sign in to send this for review" shows the holding line "Sending your quote for review arrives in 5.6", staging only.
     - **From 5.6,** it runs the sign-in gate and `saveQuote()`, and the quote reaches the 6.11 queue (5.4, decision 2).
   - **None of the outcome screens** shows the reason code or a threshold (phase row).
10. **Car declined for a reason other than a named driver** (screen 20):
    - **The car card, as drawn:** "Car · Not available", "We're unable to offer car cover", "Based on the details provided, this car quote doesn't fit the cover available through our online policy.", the car, and "Check car answers".
    - **On the car journey** there's no home quote yet, so the heading is "We're unable to offer car cover" and the second card offers one: "Insure your home with us instead?" with "Get a home quote", which shows the holding line "Home quotes are coming soon" until 5.7 (Damion, 12 Nov 2026).
    - **The bundle half as drawn** ("Your home quote is still available", "Home · Ready to buy", "Review home quote and continue") is built as the same screen given a home quote, tested with sample home answers. 5.7 shows it.
    - **Named-driver declines and referrals** keep 5.4b's R10.
11. **Add home insurance** (screen 21, adapted), after Choose cover:
    - **Heading and intro:** "Add home insurance to your car quote?", "We'll keep your car quote while you get a home quote. You can still buy car insurance on its own."
    - **The car card:** the car, the chosen cover and the main driver; the chosen price ("£458.40 a year", "Or 12 payments of £42.02 · Includes Insurance Premium Tax", or monthly first when monthly is chosen) and the total excess. The "Car quote saved" badge reads "Your car quote" *(my call: nothing is saved)*.
    - **The home card:** "Let's get a home quote", a "Home postcode" field carried over from the car journey ("Carried over from your quote. Change it if the home is elsewhere."), the next-steps line, and "Add home insurance". With a valid postcode it shows the holding line "Home quotes are coming soon" until 5.7, which starts the home journey with that postcode (Damion, 12 Nov 2026). An invalid postcode shows 5.1's postcode error.
    - **The footnote** shows the saving, not "no bundle discount": "Car and home are separate policies, each assessed on its own. Insure both with us and save 8% on the combined premiums. If one is referred or declined, you can still buy the other." The 8% is the version's `bundle_discount_rate`.
    - **Buttons:** "Continue with car only", which shows "Buying arrives in 5.6" until 5.6 (staging only), and "Back to car quote".
12. **The bundle outcome screens** (Damion, 12 Nov 2026), built and tested with sample home answers, shown by 5.7:
    - **Home referred** (screen 03): as 19, for home. The card shows the address and "Buildings and contents", "What happens next?" with the three numbered steps as drawn, and "Sign in to send this for review" in place of "Your quote is saved".
    - **Home declined in a bundle** (screen 04): "Your car quote is still available", the home card ("Home · Not available", the neutral line, the address, "Check home answers"), and the car card ("Car · Ready to buy", the car, the cover, "Car-only annual total" with the car's own total, "Continue with car only").
    - **The car's total** on screen 04 is the car alone, so no bundle discount (the phase row: "the rest of a bundle can still be bought").
13. **The cover levels and the comparison table:**
    - **Three cards,** each with the tier's name, a one-line description, its price for the chosen payment, the features it includes and its total excess. They form one radio group, and Comprehensive starts selected.
    - **A card's price** is that tier's full price with the chosen extras and IPT: `quoteTotals()`'s annual total, or `monthlyPayment()` of it. So the selected card always equals the breakdown's total *(my call)*.
    - **The table,** "What each level includes", has a row per feature and a column per tier: the monthly payment, the annual total, "Damage to your car", "Third-party damage", "Fire and theft", "Courtesy car" and "Total excess". The chosen tier's column is highlighted.
    - **What each tier includes** is product copy kept in the code, as screen 13 draws it. Essential covers third-party damage only. Comprehensive and Plus cover everything.
    - **The tier descriptions:** Essential "Core protection · Lowest price", Comprehensive "Covers your car too", Plus "More help included · Lower excess". Plus's real difference in v1 is its £150 compulsory excess against £250.
    - **On a phone,** the table is hidden and the cards (which list the features) carry the comparison. Nothing scrolls sideways *(my call)*.
    - **"View policy documents"** (drawn) waits for the documents in Phase 6, so it's left out.
14. **The prices shown include IPT.** That covers the cards, the table and the extras. The breakdown shows IPT as its own line. Monthly figures include the 10% charge.
15. **The money is checked against the server's figures.** A test composes a choice in the browser and checks it against `priceQuote()` given the same choice. The same code (`quoteTotals()`) runs in both places, so the figure can't drift.
16. **Your quote is ready (R09) shows the chosen cover** *(my call)*. Its heading becomes "Your {tier} price", and its intro "{Tier} car insurance for your …", with the chosen excess and extras: at first Comprehensive, £0 and none, as 5.4b shows it. After Choose cover, Back shows the price that was chosen. It reads the same server answer and composes it the same way.

## In scope

- **Route and search:** `step=cover` and `step=add-home` on `/quote/car`, guarded as in decision 2. The Stepper shows "Choose cover" on both.
- **Server:** `priceCar` takes `{ journey, voluntaryExcessPence }` and returns the choice data in decision 6. Its referred, declined and rate-limited results don't change, and `invalid` gains the step `cover`.
- **Engine:** `representativeApr()` in `src/features/rating/money.ts`. `quoteTotals()` and `monthlyPayment()` are reused unchanged. `carInputsFromJourney` takes the voluntary excess.
- **Feature code** in `src/features/quote/`:
  - the `cover` journey part and the composing of a choice
  - Choose cover, with the excess select, the cards, the comparison table, the extras, the pay cards and the breakdown
  - screen 21, the referred screen (19) and the declined screen (20, both halves)
  - the bundle outcome screens (03 and 04)
  - the tier and extras copy
- **Docs:**
  - `figma.md`: screens 13, 19, 20, 21, 03 and 04 marked as built in 5.5 with the changed copy noted.
  - `phase.md` and `build-plan.md`: marked done with the slice.

## Out of scope

- **Saving the quote, the sign-in gate, sending a quote for review, and Buy** (5.6).
- **A start date for cover** (Damion, 12 Nov 2026). 5.6 asks for it when buying.
- **The home journey and its prices, screen 22, and showing screens 03, 04 and 20's bundle half** (5.7).
- **"Back to your quotes" and "View policy documents"** (Phase 6).
- **New add-ons, tiers or prices.** Those need a new rating version.

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | `representativeApr()`: 10% over 12 payments, the first at the start, is 23.6%, checked against a hand calculation; 0% is 0.0% | yes |
| Unit | The cover part round-trips, starts at Comprehensive, £0 and no extras, and is dropped alone if it doesn't parse; a 5.4b journey without it still reads. Composing a choice: the lines add up to the total, extras and IPT as decided, a tier that's referred can't be chosen | yes |
| Unit | The Stepper shows "Choose cover" on `step=cover` and `step=add-home` | yes |
| Integration | `priceCar` with a voluntary excess returns three tiers with lower premiums than at £0, by v1's band multiplier; returns the add-ons and rates; still sends no factor, band, threshold or reason; answers `invalid` / `cover` for an excess that isn't offered; a tier pushed over the maximum comes back referred while the others are quoted; the browser's composed total equals `priceQuote()`'s for the same choice | yes |
| Component | Choose cover: Comprehensive starts selected; a card and the table's column select the same tier; changing the excess prices again and every card changes; ticking an extra changes the total and adds a breakdown line without another server call; monthly adds the cost of paying monthly, total payable, the 12 payments and the APR; the choice survives a refresh; a direct link to `step=cover` on an unquoted journey goes to `step=quote` | yes |
| Component | Screen 21: the chosen price and excess, the home postcode carried over, the holding lines. Screens 19, 20, 03 and 04: the copy as decided, no reason code or threshold, "Check your answers" opens About you; a named-driver decline still shows R10 | yes |
| E2E | A complete journey → Your quote → Choose cover → Plus, £250 excess, breakdown cover, monthly: every level is priced again, the breakdown and APR show, the card matches the payment, a refresh keeps the choice, and Continue reaches screen 21 (`e2e/cover.spec.ts`). Axe on Choose cover and screen 21 at 390, 768 and 1440 px | yes |
| Manual | On the PR preview at 1280, a tablet width and 393 px: the video shot above; the table hidden on the phone; screen 21; the referred and declined screens | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The manual check passes, with the results recorded here.

## Commit message

`feat: choose your cover, Essential, Comprehensive or Plus side by side, with a voluntary excess, optional extras, a price breakdown with the cost of paying monthly and its APR, the add-home offer, and the referred and declined screens`

## Sources

- **Plan:** phase.md, the 5.5 row and its testing row.
- **Figma:** screens 13 (`226:699`), 19 (`226:789`), 20 (`226:804`), 21 (`230:1434`), 03 (`222:6732`) and 04 (`222:6747`). 5.4b's frame and R09 (`249:6275`).
- **Earlier slices:**
  - 4.8: car v1's tiers, add-ons and `voluntary_excess` bands, and call 15 (the APR).
  - 5.4: decisions 1–4 and 6; `priceQuote()`, `quoteTotals()`, `monthlyPayment()`.
  - 5.4b: decisions 3 and 10 to 11; the `payment` part; R10.
- **Damion, 12 Nov 2026:**
  - The quote stays in the tab until 5.6.
  - Voluntary excess, extras and the breakdown are left to me.
  - 5.5 builds screens 03, 04 and 21 with sample home answers; "Add home insurance" and "Get a home quote" show "Home quotes are coming soon" until 5.7.
  - The start date is asked in 5.6.
  - The pay cards show on Choose cover as well as Your quote.
  - The first monthly payment is taken when cover starts.
  - The referred screens' button is "Sign in to send this for review".
