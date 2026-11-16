# 5.7 Home steps

**Status:** done (#96; spec approved by Damion, 16 Nov 2026)
**Phase:** 05-quote

## Goal

A home quote you can buy, on its own:
- **Four "Your details" steps:** About you → Property → Contents and security → Past claims (screens 05–07, with a short About you step first).
- **Then the shared steps:** Your quote, Choose cover, the sign-in gate, Confirm and pay with Stripe, and You're covered, all reused from car and told which product they're showing.
- **Everything the visitor tells us is stored.** That includes the answers the price doesn't read (valuables, window locks, the kind of alarm, and each past claim), using new columns and a new `prior_claims` table.
- **A Playwright journey** from the landing accordion's "Get a home insurance quote" to a home policy on `/account`, with axe on each home step.

- **Why:** Phase 5's exit criteria need car **and** home quotes to work end to end. `/quote/home` has been an empty shell since 5.1.
- **The split (Damion, 16 Nov 2026):**
  - **5.7** is home on its own.
  - **5.7b** is the car + home bundle: screen 21's "Add home insurance", screen 22, screen 04 shown for real, and one Stripe checkout for both policies.
  - **5.7c** stores the car answers that aren't saved yet (each incident's date, type, fault and cost; licence type; employment status; a named driver's relationship). It reuses this slice's `prior_claims` table.

## Decisions

1. **One home journey, built beside car's, reusing the shared screens** (Damion, 16 Nov 2026, approach A).
   - **New, home only:** `schemas/home-steps.ts`; `home-steps.ts` (which home steps are complete and the tab states, mirroring `steps.ts`); `HomeSteps.tsx` (the step router, mirroring `DriverSteps.tsx`); and one component per step.
   - **Shared, taught about home:** Your quote (`QuotePrice`), Choose cover, the gate (`BuyGate`), Confirm and pay, You're covered, Your saved quotes, and the referred and declined outcomes. Each takes the product and shows "Your home" (the address, property type and bedrooms) where car shows "Your car".
   - **Car's behaviour doesn't change.** Its existing tests must pass untouched, except where a shared component's props gain a `product`.
   - **Not chosen:** one config-driven step engine for both products, which rewrites the working car steps; and copying car's files, which would duplicate cover, gate and pay along with 5.6b's Stripe fixes.
2. **The home URL and steps.** `/quote/home?postcode=…&step=…`, with `step` one of `about`, `property`, `contents`, `claims`, `quote`, `cover`, `buy`. The gate's `auth` and `after` params work as on car. No `step` means `about`.
   - **The details tabs:** About you · Property · Contents · Claims. They follow car's rules (5.3, call 5): only steps up to the first unfinished one can be opened.
   - **The Stepper:** "Your details · Your quote · Choose cover · Buy", as on car (figma.md, Stepper).
   - **No add-home step.** "Continue" on Choose cover goes straight to the gate (5.7b adds the bundle).
   - **The postcode is checked with postcodes.io** in the route's loader, as `/quote/car` does: a postcode that doesn't exist goes back to `/quote?type=home&error=postcode`.
   - **5.4b's frame:** the journey header, details tabs, a "Your home" card and a help card beside each step, and the footer. The Figma screens (05–07) are drawn in the older style; they take 5.4b's frame without being redrawn, as 5.5's screens did.
3. **About you (home)** *(Damion, 16 Nov 2026: get their details before the property)*.
   - **Heading:** "Tell us about you", overline "Home · Your details".
   - **Fields:** first name, last name, date of birth. They use car's field components and messages, and its name checks.
   - **18 or over** *(my call)*: a home policy is a contract, so the line is 18, not car's 17. Message: "You must be 18 or over to get a home quote."
   - **No occupation, status or address here.** The price doesn't use them, and the address comes from the Property step.
   - **The customer row:** a first saved quote creates it from About you and the insured address. A customer who already has a row keeps it unchanged, as on car (5.6, decision 4).
4. **Property (screen 05, `222:6762`).** "Tell us about your property".
   - **Your address:**
     - The postcode starts from the link and can be changed. "Find address" runs the lookup again, and a changed postcode updates the journey and the URL (`replace`).
     - **The lookup** is a server function, `findAddresses`. It checks the postcode with postcodes.io as the car loader does (a postcode that doesn't exist shows "We couldn't find that postcode. Check it and try again."), then returns the list.
     - **"Select your address"** lists made-up addresses for that postcode *(my call; Damion agreed to the approach on 16 Nov 2026)*. postcodes.io has no street addresses, and Kerb is a demo. `demoAddresses(postcode)` is pure and deterministic: 8 to 12 addresses on one or two streets, picked from a fixed list of UK street names by a hash of the postcode, with house numbers and some "Flat 1, 22 …" lines. The town is `postcode_areas.admin_district`, falling back to the outcode. The hint reads "Addresses found for E8 3RL".
     - **"Enter address manually"** shows address line 1, address line 2 (optional) and town, using car's About you address messages.
   - **About the building:**
     - **Property type:** Detached house, Semi-detached house, Terraced house, Flat, Bungalow (`propertyTypes`).
     - **Year built:** 1500 up to this year. Hint: "Use the year the property was built."
     - **Bedrooms** *(my call, not drawn)*: 0–10, with 0 shown as "Studio". The price reads it (`bedrooms` factor), so it has to be asked.
     - **Rebuild cost:** £50,000–£5,000,000 in whole pounds, with the drawn hint lines. The upper limit sits above the decline line (£2.5m), so a decline can be reached.
   - **Button:** "Continue to contents".
5. **Contents and security (screen 06, `222:6777`).** "Your contents and home security".
   - **Total contents value:** £5,000–£500,000.
   - **Valuables total:** £0 up to the contents value. Message: "Valuables are part of your contents, so they can’t be more than the contents total."
   - **Main external door lock:** Standard lock or night latch, Five-lever mortice deadlock, Multi-point locking system (`lockTypes`).
   - **Window locks:** Locks on all accessible windows, Locks on some windows, No window locks.
   - **Burglar alarm:** No alarm, Professionally installed and not monitored, Professionally installed and monitored. The price only reads "any alarm" (`has_alarm`).
   - **Smoke alarms fitted and working:** a checkbox.
   - **Button:** "Continue to past claims".
6. **Past claims (screen 07, `222:6792`).** "Any home claims in the last 5 years?"
   - **Yes or No.** On Yes, there are claim cards (Claim 1, 2, …), up to 5 *(my call)*. Each has:
     - **Date of incident:** within the last 5 years and not in the future, using car's date field and window rule.
     - **Type of claim:** Escape of water, Theft, Accidental damage, Storm or flood, Fire, Subsidence, Other.
     - **Total claim amount:** £0–£1,000,000. Hint: "Amount paid or estimated."
     - **Claim status:** Settled, Open, Withdrawn.
   - **"Ready to get your quote?"** with the confirmation tick box, as on car's claims step.
   - **The price's `pastClaims`** is the number of claims entered. 3 or more is referred (rating v1).
   - **Button:** "Get my home quote".
7. **Pricing: `priceHome`.** A server function beside `priceCar`. It checks the home journey again with the step schemas, builds `HomeInputs` (with the postcode area from the journey's postcode), and runs `priceQuote()` against the active home rating version. It returns quoted, referred or declined, and nothing is saved. An answer that no longer passes sends the visitor back to that step, as car does.
8. **Outcomes.**
   - **Referred:** screen 03 (5.5's `HomeReferred`), now fed by the real home answers.
   - **Declined (rebuild cost of £2.5m or more):** "We’re unable to offer home cover", with a neutral reason and no thresholds. It mirrors screen 20's car-declined layout, with an "Insure your car with us instead?" card that links to `/quote/car?postcode=…` *(my call)*.
9. **Saving: `saveHomeQuote`.** It follows `saveCarQuote` (5.6, decision 5): a `defineWrite` under the same `quote.save` rate limit, with an idempotency key. It runs the checks and pricing again, uses `customerForQuote` and `saveQuote()`, and makes one save per journey hash.
   - **Rows:** a `properties` row (decision 10), plus a `prior_claims` row for each claim.
   - **A referred quote is saved too.** A declined one isn't.
   - **The gate's sign-up path** (5.6, decision 1) saves a home journey when the sign-up came from `/quote/home`.
10. **Data: one migration, generated with the schema, that only adds things.**
    - **`properties` gains:**
      - `valuables_pence` (`pence`, nullable);
      - `window_locks` (text, nullable, checked against `windowLockTypes`: `all_accessible`, `some`, `none`);
      - `alarm_type` (text, nullable, checked against `alarmTypes`: `none`, `installed_unmonitored`, `monitored`).
      - **Nullable because older rows can't know these answers.** Every save from this slice fills them, and so does the seed. `has_alarm` stays, because the price reads it; save sets it to `alarm_type <> 'none'`.
    - **A new `prior_claims` table** (one row per past claim, for any product):
      - **Columns:** `id`, `quote_item_id` and `product` (FK to `quote_items` with cascade, via `itemOf`'s pattern), `occurred_on` (date), `type` (text), `amount_pence`, `status` (text, nullable), `fault` (text, nullable), `created_at`, `updated_at`.
      - **Checks:** `amount_pence >= 0`. `type` is checked against `homeClaimTypes`; 5.7c widens it for car. A home row has a `status` and no `fault`. `status` is checked against `priorClaimStatuses`.
      - **Indexes:** on `quote_item_id` and `updated_at`.
    - **The `past_claims` count stays on `properties`.** It's the rated input, and equals the number of `prior_claims` rows saved with it.
    - **Kept in step:** the data contract (`data-contract.ts` and its test), `db:check-app-role` grants, account closure (quotes deleted on closure take their `prior_claims` with them by cascade, so nothing is added there), and the seed (fills the new columns and adds claim rows for seeded homes that have past claims).
    - **No dedupe step is needed.** No unique index is added (see the 0018 lesson).
11. **The shared screens for home.**
    - **"Your home" card:** the address line, postcode, property type and bedrooms. It's shown wherever car shows "Your car": beside each step, on the gate's "Your cover is waiting", Confirm and pay's summary ("Property" in place of "Vehicle"), You're covered and Your saved quotes.
    - **Choose cover:** home's tiers, excesses and add-ons come from rating v1 (home emergency, legal expenses, personal possessions). 5.5's tier and add-on copy (`cover.ts`) is car's, so home gets its own *(my call)*:
      - **Comparison rows:** Buildings cover, Contents cover, Accidental damage, Alternative accommodation.
      - **Essential**, "Core protection · Lowest price": every row except Accidental damage.
      - **Comprehensive**, "Adds accidental damage": every row.
      - **Plus**, "More help included · Lower excess": every row.
      - **Home emergency cover:** "24/7 help with boiler, plumbing and electrical emergencies".
      - **Family legal protection** (`legal_expenses`): "Legal costs up to £50,000 for disputes about your home".
      - **Personal possessions:** "Your belongings covered away from home, up to £2,500".
    - **Stripe:** `startCheckout` names the line "Kerb home insurance, {Tier}, {address line 1}". Fulfilment, webhooks and `/account` are product-agnostic already (5.6b) and don't change.
12. **The journey store.** The home journey's object (already keyed by product, 5.1) gains `aboutYou`, `property`, `contents` and `homeClaims` parts, each read on its own so a broken part is dropped alone (5.1, call 15), plus the existing `cover`, `payment` and `saved`.

## In scope

- **Server:** `priceHome`, `saveHomeQuote`, the gate's sign-up save for home, `startCheckout`'s home line name, and `demoAddresses`.
- **Data:** the migration in decision 10, the data contract, the seed and the app-role check.
- **UI:**
  - the four home steps;
  - the "Your home" card;
  - the home outcomes;
  - the shared screens' home variants;
  - the `/quote/home` route with its loader.
- **Docs:**
  - this spec;
  - `phase.md` (5.7's row, and 5.7b and 5.7c rows added);
  - `build-plan.md` (5.7b and 5.7c boxes);
  - `figma.md` (screens 05–07 built in 5.4b's frame, with bedrooms added and About you before Property; screen 04 and 22 moved to 5.7b).

## Out of scope

- **The car + home bundle** (5.7b).
- **Storing car's unsaved answers** (5.7c).
- **A real address lookup** (Ideal Postcodes, getAddress.io): the demo list stands in.
- **Home price changes:** rating v1 is used as it is. Valuables, window locks, the kind of alarm and claim details are stored but don't change the price.

## Tests

| Layer | What |
|---|---|
| Unit | Home step schemas: the age line (18), rebuild cost and contents ranges, valuables not above contents, year built range, bedrooms range, the claims shape (date window, type, amount, status, up to 5, Yes needs at least one), the confirmation box |
| Unit | `demoAddresses`: same postcode, same list; different postcodes, different lists; every entry has a line 1 and a town |
| Unit | `home-steps.ts`: completeness and tab states, including a claim that leaves the 5-year window overnight |
| Component | Property: picking an address fills the journey; manual entry; a changed postcode redoes the list. Contents: the valuables message. Claims: add, remove, Yes with none. Tabs can't skip ahead |
| Integration | `priceHome` gives quoted, referred (rebuild £1m, 3 claims, built 1700) and declined (rebuild £2.5m); a tampered journey is refused |
| Integration | `saveHomeQuote` writes `properties` with the new columns, one `prior_claims` row per claim and `has_alarm` from `alarm_type`; a double submit with one key is one save; a referred quote is saved and a declined one isn't |
| Integration | The migration: constraints refuse a bad `window_locks`, `alarm_type`, claim type or status, a negative amount, and a home claim with a `fault`; deleting a quote item deletes its claims |
| E2E | `e2e/home-buy.spec.ts`: accordion "Get a home insurance quote" → postcode → About you → Property → Contents → Claims → Your quote → Choose cover → sign in → Stripe `4242…` → You're covered → the policy on `/account`, at phone width; axe on each home step |

## Done when

- [ ] A home quote can be bought end to end on the preview with Stripe's test card, and the policy shows on `/account`.
- [ ] Every answer from the four steps is in Neon: `customers`, `properties` (with the new columns) and `prior_claims`.
- [ ] A referred home quote shows screen 03 and is saved; a declined one shows the declined screen and isn't.
- [ ] Car's journey and its tests are unchanged.
- [ ] `vp check`, `vp test`, the integration tests and the home E2E pass in CI.
- [ ] The seed runs on `dev` with the new columns and claim rows.

## Commit message

`feat: get a home quote and buy it: about you, your property with its address, contents and security, and past claims, every answer stored, priced, paid with Stripe and saved as a policy`

## Sources

- Figma: screens 05 Property `222:6762`, 06 Contents & security `222:6777`, 07 Past claims `222:6792`, 03 Home referred `222:6732`; Revamp frame `249:5806` for layout.
- Rating: `src/server/reference/rating/home-v1.ts` (factors, referral and decline lines, add-ons).
- Car's journey: `steps.ts`, `DriverSteps.tsx`, `schemas/driver-steps.ts`, `server/quote/{price,save,checkout}.ts`.
- 5.6 and 5.6b specs for the gate, save, pay and Stripe.

## Notes from the build

- **Home has no voluntary excess.** Rating v1 has no voluntary-excess factor for home, so Choose cover hides the picker on the home journey, and the server only accepts £0 for home (any other amount goes back to cover).
- **The step field helpers are shared.** `schemas/fields.ts` holds car's field building blocks (dates, money, choices, date of birth with a minimum age), and car's schemas import them unchanged.
- **The valuables check runs early.** It uses Zod 4's `refine` with `when`, so "Valuables are part of your contents…" shows even while other answers on the page are still missing.
- **`prior_claims` is copied and mutable,** so migration 0023 adds its `set_updated_at` and `record_delete` triggers by hand, as 0021 did. Its foreign key is written out in full (not `itemOf`), because one table serves both car and home.
- **The seed's new home values are derived, not drawn.** Valuables, window locks, the kind of alarm and each past claim are worked out from each seeded home's existing answers, so no other seeded value moves.
- **Seed and old rows.** Rows saved before 5.7 have null valuables, window locks and alarm type, and a `past_claims` count with no `prior_claims` rows behind it.
- **A first visit starts the journey in the step router.** `HomeSteps` calls `beginJourney`, because a child's effect runs before the journey shell's.
- **The address lookup.** When postcodes.io can't answer, Property switches to manual entry with a line saying so.
- **You're covered before the purchase loads** reads the product from the tab that saved the quote. A home quote opened in a fresh tab shows "Car insurance · Purchase" until the purchase loads.
- **Left for 5.7b:** car's declined screen (20) still says home quotes are coming soon. 5.7b rebuilds the add-home and bundle screens and links it then.
- **Reviews.** Two checkpoint reviews (after the server work and after the shared screens) found nothing critical or important. Their minor points: a tampered impossible date (31 February) passes the date check and makes the save fail instead of saying "invalid", as on car; a few type casts around `onInvalid`; the gate's auth link lost its route typing.
