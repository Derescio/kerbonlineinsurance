# 5.7b Car + home bundle

**Status:** done (spec approved by Damion, 16 Nov 2026)
**Phase:** 05-quote

## Goal

Car and home bought together, as a bundle with the 8% saving:
- **From car:** screen 21's "Add home insurance" runs the home steps while the car quote waits in the tab. Home's Choose cover (screen 22) shows the car quote, both prices, the saving and the combined total.
- **From home:** home's Choose cover offers "Add car insurance". The car journey then runs, keeping the home answers, and its screen 21 skips straight to the bundle.
- **One quote, one checkout:** the gate saves one quote with a car item and a home item, and Confirm and pay takes one Stripe payment (or one monthly subscription) for both. The result is two policies under one `bundles` row.
- **When one half can't be bought:** screen 04 (home declined) and screen 03 (home referred) let the car be bought alone. Car's declined screen 20 links to a home quote.

- **Why:** the phase row and the exit criteria call for car and home bought together. 5.5 built the bundle screens with sample answers, and 5.6 and 5.6b built a pay path that already handles a quote with two items. 5.7 made home buyable on its own. This slice joins them.

## What exists already

- **Pricing:** `priceQuote()` takes a car and a home item and splits the bundle discount between them (`splitBundleDiscount`). Both rating v1 versions carry `bundle_discount_rate` 0.08 and `monthly_credit_charge_rate` 0.1.
- **Buying:** `purchase.ts` writes a `bundles` row when a quote has more than one item, then one policy per item, all starting on the one date Confirm and pay asks for (`acceptQuote` sets it on every item). Fulfilment, the webhooks, lapse and void (one subscription, one email for every policy on it) and `/account` don't care which product they're handling (5.6b).
- **Screens:** `AddHome` (21), `HomeDeclinedBundle` (04) and the bundle half of screen 20 (`CarDeclined`'s `home` and `onContinueHome`) were built in 5.5 with sample answers (`cover-fixtures.ts`). `HomeReferred` (03) and a home-alone `HomeDeclined` are already wired to real answers by 5.7 (`HomeQuote.tsx`). "Add home insurance" and screen 20's "Get a home quote" still show "Home quotes are coming soon".
- **What assumes one item:** `monthlyPaymentFor` takes one rating version, and its four callers pass `items[0]` (`checkout.ts`, `purchase.ts`, and `quotes.ts` twice). `getQuoteForPayment`'s `PaymentSummary` has single `car`, `home` and `coverLevel` fields. Your saved quotes picks one item and `policies[0]`. `purchaseItems` gives each policy its premium before the bundle discount. The sign-up hook reads one `{ product, journey }`. The `policy_confirmed` email has a car line and no home line.
- **The journey store** keeps one set of answers per product in the tab, and `beginJourney` keeps what's stored. Starting car doesn't clear home, and starting home doesn't clear car.

## Decisions

1. **The bundle runs on `/quote/home`, which knows a car quote is waiting** (Damion, 16 Nov 2026, approach A).
   - **The mark:** the home journey gains `bundle: { carJourneyId }`, stored with its answers, so a refresh keeps it. It's set by screen 21's "Add home insurance" and by home's "Add car insurance" (decision 3).
   - **The mark only counts while it matches.** The bundle is on when the home journey's `bundle.carJourneyId` equals the stored car journey's `journeyId`, and that car quote is priced as quoted with a chosen cover. Otherwise home runs as on its own (5.7), and the mark is ignored.
   - **The home steps don't change.** The bundle only changes home's Choose cover, the gate's save, Confirm and pay's summary, You're covered and Your saved quotes.
   - **Not chosen:** running the home steps inside `/quote/car` (B), which duplicates 5.7's routing; and two quotes joined at payment (C), which goes against the schema: a bundle belongs to one quote, and the discount is worked out per quote.
2. **From car: screen 21's "Add home insurance".**
   - **With a valid postcode,** it starts the home journey with that postcode (`beginJourney("home", …)`), sets the mark and goes to `/quote/home?postcode=…`. With an invalid one it shows 5.1's postcode error, as now.
   - **When the home answers are already complete** (the visitor came from home, decision 3), it goes straight to `step=cover`. Otherwise it goes to the first home step that isn't finished, as the home tabs' rules decide.
   - **The holding line goes.** "Continue with car only" and "Back to car quote" don't change.
3. **From home: the middle option** (Damion, 16 Nov 2026).
   - **Home's Choose cover, not in a bundle,** shows a line under the extras: "Insure your car with us too and save 8% on both." with "Add car insurance". The 8% is the version's `bundle_discount_rate`.
   - **"Add car insurance"** sets the mark, starts the car journey with the home postcode and goes to `/quote/car?postcode=…`. The car steps run as they do now, through car's Choose cover to screen 21, where decision 2 takes them straight to home's Choose cover with the bundle panel.
   - **Car's About you and home's About you ask the same person's name and date of birth.** Whichever is answered second starts filled in from the first *(my call)*. The visitor can still change it (decision 6 checks they match).
4. **Home's Choose cover in a bundle: screen 22's side panel** (`230:1449`, in 5.4b's frame).
   - **The panel:** "Your car quote is still saved" becomes "Your car quote" *(my call: nothing is saved yet, as 5.5 decided for screen 21)*, then the car (plate or make and model) and its tier, then "Car" and "Home" lines with each item's price after its share of the discount, then the saving ("Bundle saving −£X"), then "Together: £X a year" with "Or 12 combined payments of £Y".
   - **The saving is shown, not "no bundle discount"** as drawn (5.5, decision 11).
   - **The money comes from `priceQuote()` given both items,** composed in the browser from the two price answers as 5.5's `quoteTotals()` does, and checked against the server in a test (5.5, decision 15).
   - **The payment choice:** the bundle has one. Home's Choose cover starts from the car's choice and sets both journeys' `payment` *(my call: one checkout means one way of paying)*.
   - **Buttons:** "Continue to sign in" (the gate, saving the bundle) and "Continue with home only", which clears the mark and goes to the gate as 5.7 does. "Back to car quote" goes to car's Choose cover and keeps the mark.
   - **The rest of screen 22** is home's Choose cover as 5.7 built it. Home's own tiers stay (not the drawn "Buildings only / Contents only / Buildings + contents").
5. **When one half can't be bought.**
   - **Home declined** (rebuild cost of £2.5m or more): screen 04, `HomeDeclinedBundle`, given the real answers, in place of 5.7's home-alone `HomeDeclined` while the mark is live. "Continue with car only" goes to car's gate at the car's own price. "Check home answers" goes to the Property step.
   - **Home referred:** screen 03, `HomeReferred`, given the real answers, plus "Continue with car only" *(my call)*. "Send this for review" saves the home quote on its own for 6.11's queue (5.7, decision 9), with no discount. The car is bought separately, at its own price.
   - **"Continue with car only"** (on 03 or 04) clears the mark and goes to car's gate. The home answers stay in the tab *(my call)*. "Send this for review" on 03 also clears it.
   - **Car declined with a home quote ready** (the visitor came from home, decision 3, or went back and changed a car answer): screen 20's bundle half as 5.5 built it, "Your home quote is still available" with "Continue with home only", which clears the mark and goes to home's gate *(my call)*.
   - **Car referred with a home quote ready:** car's referred screen (19) adds a "Continue with home only" link that does the same *(my call)*.
   - **Either way** the bundle is off (decision 1), and the other product is bought on its own at its own price.
   - **Car declined, screen 20:** "Get a home quote" starts the home journey with the car's postcode and goes to `/quote/home`. No mark is set: it's a home quote on its own. The holding line goes.
6. **Saving: `saveBundleQuote`.**
   - **A `defineWrite`** under the same `quote.save` rate limit and idempotency, like `saveCarQuote` and `saveHomeQuote`. It takes `{ car, home }` journeys and checks each one with `checkCarJourney` and `checkHomeJourney`. An answer that no longer passes sends the visitor back to that product's step (`{ status: "invalid", product, step }`).
   - **It prices both** with `priceQuote([car, home])` against the active versions, each with its chosen cover. If either item isn't quoted, nothing is saved, and the answer says which item it was, so the visitor sees screen 03 or 04.
   - **One customer:** made from car's main driver (name, date of birth and car's address), as a car save does. The quote's `postcode` is the car's; the home's own address and postcode are on its `properties` row, so the two can differ *(my call)*. The car's and home's names and dates of birth must match; if they don't, the save answers `invalid` for home's About you with "Your name and date of birth must match your car quote." *(my call: one policyholder per bundle)*.
   - **One quote with two items** through `saveQuote()`. The car item has its vehicle and drivers, the home item its property and `prior_claims`, with one start date (tomorrow until Confirm and pay sets it).
   - **The gate's sign-up path** (5.6, decision 1) saves a bundle when the sign-up came from a home journey with a live mark. The gate sends both journeys, and the sign-up body's quote gains a third shape, `{ product: "bundle", car, home }`, beside the car and home ones *(my call)*.
   - **Each policy's premium is its share after the discount** *(my call)*. `purchaseItems` works out each item's share with `splitBundleDiscount`, as `priceQuote` did, so the two policies' `annual_premium_pence` add up to what was charged before IPT. `/account` shows the true figure, and Phase 6 refunds from it.
   - **No migration.** The schema already holds a quote with two items and a bundle.
7. **Confirm and pay for a bundle.**
   - **The summary** shows both items: "Your car" and "Your home" cards, each with its tier and price, then the bundle saving and the total.
   - **One payment choice** for the combined total. Monthly is 12 payments of `monthlyPayment(total)` with the one `monthly_credit_charge_rate`.
   - **The rates must agree.** `monthlyPaymentFor` takes every item's rating version in place of one, and each caller passes all of them. Like `priceQuote` with different bundle rates, it refuses versions with different monthly rates. That's a config error, not a choice.
   - **`PaymentSummary` lists its items** (each with its product, tier, price and car or home) in place of single fields, and the bundle saving.
   - **Stripe:** `startCheckout`'s line reads "Kerb car + home insurance, {car tier} and {home tier}, {plate or car} and {address line 1}" *(my call)*. Everything after the session is 5.6b's and doesn't change, apart from the email below.
   - **The confirmation email** (`policy_confirmed`) gains a home line, so a bundle's email names the car and the home with both references *(my call)*.
8. **After paying.**
   - **You're covered** lists both policies, each with its reference, product, tier and cover dates, then the total paid or the monthly payment.
   - **Your saved quotes** shows a bundle as one card: both items, "Car + home", the combined total and both policy references once it's bought. A bundle's quote holds both (`quotes.ts`, "5.7b's bundle shows both").
   - **`/account`** already lists each policy. Nothing changes there.
   - **Leaving the tab:** after buying, both journeys are cleared from the tab, as a single purchase clears its own.

## In scope

- **Server:** `saveBundleQuote` and the sign-up body's bundle shape; `monthlyPaymentFor` over every item and its callers; each policy's discounted premium in `purchaseItems`; `startCheckout`'s bundle line name; `PaymentSummary`'s items; Your saved quotes' read; the email's home line.
- **UI:**
  - the mark, and reading it (decision 1);
  - screen 21's "Add home insurance" and screen 20's "Get a home quote", live;
  - home's "Add car insurance" line;
  - About you filled in from the other product;
  - screen 22's side panel and its buttons;
  - screens 03 and 04 in a bundle, with "Continue with car only"; screen 20's bundle half and 19's "Continue with home only";
  - Confirm and pay's, You're covered's and Your saved quotes' bundle views.
- **Docs:**
  - this spec;
  - `phase.md` (5.7b's row);
  - `build-plan.md` (5.7b's box);
  - `figma.md` (screens 04, 21 and 22 built in 5.7b, with the changed copy: the saving shown, "Your car quote", home's own tiers).

## Out of scope

- **Adding a policy to one already bought** (a car policy joined to a home policy mid-term). Each bundle is bought as one quote.
- **Cancelling or changing one policy in a bundle** (Phase 6).
- **A mirror of screen 21 for home** (the full "both ways" option, not chosen).
- **Storing car's unsaved answers** (5.7c).
- **Price changes.** Rating v1 is used as it is.

## Tests

| Layer | What |
|---|---|
| Unit | Reading the mark: on when the car journey id matches and car is quoted with a cover; off for a missing, different or unpriced car journey |
| Unit | Screen 22's panel money equals `priceQuote([car, home])` for the same choice: each item's discounted price, the saving and the total, annual and monthly |
| Component | Screen 21: "Add home insurance" with a valid postcode starts home with the mark; with complete home answers it goes to `step=cover`. Home's Choose cover: the "Add car insurance" line off a bundle, the panel on one; "Continue with home only" clears the mark. About you filled from the other product |
| Component | Screens 03 and 04 with real answers; "Continue with car only" goes to car's gate. Screen 20's "Get a home quote" opens `/quote/home` with the postcode |
| Integration | `saveBundleQuote`: one quote with two items, the discount on each, a vehicle and a property row, `prior_claims` for home's claims; a double submit with one key is one save; home referred or declined saves nothing and says which; mismatched names answer `invalid` for home's About you |
| Integration | Buying a bundle: one `bundles` row, two policies with the same start date whose premiums add up to the discounted subtotal, one payment schedule for the combined total; `monthlyPaymentFor` refuses mismatched monthly rates; the sign-up hook saves a bundle |
| E2E | `e2e/bundle-buy.spec.ts`: car journey → Choose cover → "Add home insurance" → the home steps → Choose cover with the panel → sign in → Stripe `4242…` → You're covered with both policies → both on `/account`, at phone width. A second test starts at home, adds car and reaches the panel with the home answers kept |

## Done when

- [ ] A bundle can be bought end to end on the preview with Stripe's test card, both policies show on `/account`, and Stripe's dashboard has one payment for the combined total (Damion's manual check).
- [ ] Starting at home and adding car reaches the bundle panel without re-answering home (Damion's manual check).
- [x] A home declined in a bundle shows screen 04, and the car can be bought alone at its own price (`bundle.browser.test.tsx`, "home declined: screen 04").
- [x] Car's and home's journeys on their own, and their tests, are unchanged. The only edits to their tests follow the reshaped types (`items`, `policyReferences`) and the holding lines that 5.7b replaces.
- [ ] `vp check`, `vp test`, the integration tests and the bundle E2E pass in CI.

## Notes from the build

- **Found by the E2E:** pressing Continue on car's Choose cover without changing anything never stored the car's cover, so the bundle wasn't live on the home side. "Add home insurance" now stores it.
- **Checkpoint fixes:** in a bundle, home's Choose cover stores the car's payment choice on the home straight away, so the gate and Pay agree with the panel. The panel says "Your car quote needs another look before it can be bought." when the car stops being quoted, instead of waiting for ever.
- **The mismatch message** shows on the gate with "Check your details", which goes back to About you. About you has no place for a message from the server.
- **Screen 04 waits** for the car's own price ("Working out your price…") rather than flash home-alone's declined screen.
- **You're covered** clears the car by the home's mark: the bundle is saved on the home's journey only.
- **Each policy's premium** is its share after the saving, so `/account` shows what was charged. Policies bought before 5.7b weren't bundles, so nothing changes for them.
- **A rating version that changes `monthly_credit_charge_rate` on one product alone** makes every new bundle refuse, by design (decision 7). The quotes integration test runs its bundle reads before the test that activates a car v2 with another rate.
- **Left as minor:**
  - paying a bundle after "home only" cleared the mark can leave the car's answers in the tab;
  - the car-side "Continue with car only" keeps the mark (harmless: paying the car clears its journey);
  - the bundle gate's overline still reads "Home insurance / Buy";
  - "Back to car quote" is a button that navigates.

## Commit message

`feat: buy car and home together and save 8%: add home to a car quote or car to a home quote, see both prices and the saving side by side, and pay once for both policies`

## Sources

- Figma: screens 21 Start a car + home bundle `230:1434`, 22 Home quote & choose cover `230:1449`, 04 Bundle partially declined `222:6747`, 03 Home referred `222:6732`, 20 Car declined · Home available `226:804`; Revamp frame `249:5806` for layout.
- 5.5 (decisions 10–12 and 15), 5.6 (decisions 1, 4 and 5), 5.6b and 5.7 specs.
- Code: `AddHome.tsx`, `Outcomes.tsx`, `HomeSteps.tsx`, `DriverSteps.tsx`, `journey-store.ts`, `server/quote/{save,checkout,purchase}.ts`, `server/data/{pay-quote,quotes}.ts`, `features/rating/price-quote.ts`.
