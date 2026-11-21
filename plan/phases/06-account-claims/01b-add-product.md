# 6.1b Add another product later

**Status:** done (#108; spec approved by Damion, 19 Nov 2026)
**Phase:** 06-account-claims

## Goal

A customer who already holds one product can start the other from the Overview, with About you and the postcode filled in from their record. While they hold an active policy of the other product, the new quote gets that version's `bundle_discount_rate` (8% in v1) off its own premium. The policy they already have is left alone until its renewal.

**Why:** 5.7b only discounts car and home when both are on the same quote. Someone who bought car last month and wants home now would otherwise pay the full home price, and the Overview has nowhere to start that journey.

## What exists already

- **Overview** ([Overview.tsx](../../../src/features/account/Overview.tsx)): policies, the empty state ("You don’t have any policies yet." and "Get a quote"), and "Your saved quotes". 6.1 left the add-product card out (decision 7). A policy is **held** when it is active (including one that starts later) or lapsed. Cancelled policies, and ones whose term has ended, are not held.
- **The customer record** ([customers.ts](../../../src/server/db/schema/customers.ts)): first name, last name, date of birth, address and postcode. It has no employment status or occupation. It is written at the first saved quote and is not updated by a later one.
- **Journeys** live in the tab (`beginJourney` in [journey-store.ts](../../../src/features/quote/journey-store.ts)). `prefillAbout` ([bundle.ts](../../../src/features/quote/bundle.ts)) copies a name and date of birth from one journey to the other. Screen 21 can skip home's About you because the car quote already answered it. A dashboard start has no other journey to copy from.
- **The 8%** is `bundle_discount_rate` on the car and home rating versions. `priceQuote()` applies it only when the quote has both a quoted car item and a quoted home item, split by `splitBundleDiscount` across the selected-tier premiums (add-ons are not discounted). IPT is calculated on each item after its share. A one-item quote stores `bundle_discount_pence` 0. `purchaseItems` repeats that split only when the saved quote has more than one item, and the new policy's `annual_premium_pence` is after its share.
- **A same-quote bundle** writes a `bundles` row and groups the two policies on the Overview, with the saving named under "A year".
- **Choose cover** already has a line for the other product on the same quote: home says "Insure your car with us too and save 8% on both." Car's screen 21 offers "Add home insurance". The 8% there is the version's rate, not a fixed number.
- **Pay** charges the price stored on the quote. Nothing reads the customer's other policies while pricing.

## Decisions

1. **One card per product they don't hold.** Under "Your policies", a card for each buyable product (car, home) that is not held. Business is not buyable, so it never gets a card.
   - Active car only, or a lapsed car only: "Add home insurance". Active home only, or a lapsed home only: "Add car insurance". Both held: no card. Nothing held: no card, and frame 03's "Get a quote" stays.
   - The button is "Add home insurance" or "Add car insurance". When an active policy of the other product earns the saving (decision 3), the card also says "You save 8% because you already insure your car with us." (or "your home"). The percent is the version's rate. A lapsed policy still shows the card, with no saving sentence. *(my call: the card is how they start the other product; the sentence is only true when the saving applies)*
2. **The card starts a fresh journey for that product.** On the Overview (which is `private, no-store`), the click writes that product's journey in the tab and opens its first step. Postcode, name, date of birth and address come from the customer record. Employment status and occupation stay empty, because the record doesn't have them, so About you still asks those. The address is a typed-in address they can change or replace from the list. About you is shown, not skipped. The other product's journey in the tab is left as it is. A quote already saved on the server stays in "Your saved quotes". *(my call: filling an old half-finished journey would hide the customer's record behind whatever the tab still held)*
3. **The saving applies to a one-product quote.** A signed-in customer's quote gets `round(selected-tier premium × bundle_discount_rate)` off that item when all of these are true:
   - the quote has one quoted product, car or home;
   - the customer has a policy of the other product with status `active` and `ends_on` today or later (Europe/London). One that starts later still counts. Cancelled, lapsed, and a term that has ended do not;
   - the rate is the **new** item's rating version, the same rate a same-quote bundle uses.
   - Add-ons are not discounted, and IPT is on the premium after the discount plus the add-ons, matching `quoteTotals`.
   - Several qualifying policies: the earliest `created_at`, then `id`.
   - A quote that already has both products keeps today's split and does not also take this saving.
   - `priceQuote()` stays a function of the items it is given. The lookup of the earning policy is a server read; the same rounding is applied by the caller that has that result. A guest has no earning policy, so their price is unchanged until they sign in.
4. **Where the customer sees it.**
   - Already signed in (the dashboard path): Choose cover shows the discounted price and "You save 8% because you already insure your car with us." While that sentence is showing, the same-quote offer ("save 8% on both" / screen 21's "Add home insurance") is hidden, so the page doesn't promise a second 8%. *(my call)*
   - A guest's quote is priced again when it is saved at sign-in. The pay screen shows the discounted price and the same sentence. Their earlier Choose cover stays the full price they saw as a guest.
5. **Pay checks again, and the old policy stays put.** Inside the pay transaction the earning policy is read again. If it still qualifies, the stored discount is charged. If it has been cancelled, lapsed or its term has ended, the quote is re-priced without the saving, that price is stored, and nothing is charged until the customer sees it. The pay screen then says "Your car policy is no longer active, so this price doesn’t include the saving." (or "Your home policy"). The existing policy's premium, its payments and its Stripe subscription are not changed. No refund, no mid-term change. Renewal can pick the saving up later; that has no slice yet.
6. **How the saving is recorded** (for 9.5). *(my call)*
   - The amount stays in `quotes.bundle_discount_pence`. The new policy's `annual_premium_pence` is after it, as `purchaseItems` already does for a share.
   - A nullable `quotes.bundle_policy_id` references the policy that earned it, with a composite foreign key `(bundle_policy_id, customer_id)` → `policies (id, customer_id)`, `ON DELETE RESTRICT`. It is set only for this one-item saving. A same-quote bundle leaves it null. A quote with no saving leaves it null.
   - No `bundles` row. That row means two policies bought on one quote. The new premium is simply the discounted one, and "A year" sums the held premiums as it does now. Decision 7 is how the Overview shows it.
   - 9.5 can tell the two discounts apart: two items and a null `bundle_policy_id` is a same-quote bundle; one item and a `bundle_policy_id` is this saving.
7. **Car + home is celebrated** (Damion, 20 Nov 2026; Figma `258:3711`).
   - A customer with an active car policy and an active home policy (neither ended) gets the dark "Car + home. Better together." banner at the top of "Your policies", however the two were bought. It stands in for the plain "Car + home bundle" heading, and the policies are listed under it. A lapsed or ended half means no banner, and a same-quote bundle falls back to its heading.
   - The lime panel ("A little bundle brilliance", the amount, "saved every year", "Already included in your price") shows the yearly saving: a same-quote bundle's discount while both of its policies are held, plus a saving earned under decision 6 while the policy that earned it is still active. A whole-pound amount drops the pence ("£96"). With no saving, the panel is left out and the rest of the banner stays.
   - The line under the title says where the saving came from: "Your home insurance costs less because you already insure your car with us." (or the car the other way round) for an earned saving; "Covered together, so you pay less for both." for a bundle's saving, or any mix; "Your car and home are covered. One less thing to think about." with no saving.
   - One product, two of the same product, or a cancelled, lapsed or ended half: no banner.
   - There is no extra line on the discounted policy's row. "A year" says "after your £X saving" when part of it was earned this way, and "after your £X bundle saving" otherwise.
   - The pay screen names this saving's row "Your saving", not "Bundle saving", and keeps the "Why this price" sentence.

## In scope

- The Overview cards, and starting the car or home journey from the customer record
- The one-item saving at price, at save after sign-in, and again in the pay transaction
- Choose cover's sentence, and the pay screen's sentence when the saving has been removed
- `quotes.bundle_policy_id` and the purchase path using it for a one-item quote
- The migration on dev before the preview check

## Out of scope

- Changing the existing policy before renewal, including Stripe and refunds
- Discounting a second policy of the same product (a second car, while they hold only car)
- Business
- A `bundles` row or a `policies.bundle_id` for the two policies (the banner in decision 7 is how they are shown together)
- Renewal applying the saving to the older policy
- Screen 21 and the same-quote bundle, except hiding that offer while this saving is already on the price

## Tests

| Layer | What |
|---|---|
| Unit | One item and a rate: `round(premium × rate)` off the selected tier, add-ons undiscounted, IPT on the net premium; a quote with both products keeps today's split and ignores an earning policy |
| Integration | A car policyholder's home quote gets 8% off, and a home policyholder's car quote too. No saving when the other policy is missing, cancelled, lapsed, or its term has ended. A policy that starts later still earns it. Two qualifying policies: the earliest is stored on `bundle_policy_id`. The existing policy's premium and payments are unchanged, and no `bundles` row is written |
| Integration | A guest quote gains the saving when it is saved after sign-in. A policy cancelled between that price and pay is re-priced without the saving, and pay does not charge the old amount |
| Component | Overview: "Add home insurance" for a car policy (active or lapsed), "Add car insurance" for a home policy, neither card when both are held or none are, the saving sentence only when an active other policy earns it. The click opens that product's first step with name, date of birth, postcode and address filled, and employment still empty |
| Component | Overview banner: an active car and home show "Car + home. Better together." with the saving (a same-quote bundle's "£96", or an earned "£38.14"); no saving hides the £ panel; a lapsed half shows no banner. "A year" says "after your £X saving" for an earned saving. Pay names it "Your saving" |
| Component | Choose cover, signed in and qualifying: the discounted price and the sentence; the "save 8% on both" offer is absent. Pay screen after the earning policy lapses: the full price and "no longer active" |
| E2E | Customer with a car policy → dashboard "Add home insurance" → About you prefilled → Choose cover shows the saving → pays → both policies on the dashboard |

## Done when

- The Overview shows the card for the product they don't hold, and it starts that journey filled in from the customer record.
- A qualifying quote is 8% off its own premium on Choose cover and on the policy that is bought. The other policy is unchanged.
- A policy that stops qualifying before pay is dropped from the price, and the new price is shown before any charge.
- `quotes.bundle_policy_id` is set for this saving and null for a same-quote bundle.
- A customer with an active car and an active home sees the car + home banner, with the yearly saving when there is one.
- The migration has run on dev, and the tests above pass in `ci`.
- Preview manual check by Damion.

## Shipped with it (#108)

- **My quotes** (`/quote/retrieve`) redrawn to Figma `270:3759` for every state (ready, under review, bought, expired) and for one product or a bundle. "Your saved quotes" is "My quotes" everywhere a customer reads it: the Overview's button (12px corners, inside the 16px card), the page heading and title, the sign-up message, and the refunded page's link.
- **CI fixes after the first push:** `quotes.bundle_policy_id` in the data contract; the saving's row helpers moved to `multi-policy-rows.ts` (like `quote-rows.ts`), and `getMultiPolicyOffer` and `getMyAddProducts` exported from `data/index.ts` with a signed-in permission case each.

## Checks (Damion, 20 Nov 2026)

- **Local manual check:** car policy KRB-818784 bought, then home KRB-428342 from the Overview's card. The home quote KRB-Q-71234 has 3814p off (8% of the 47670p premium) and `bundle_policy_id` set to the car policy, with no `bundles` row. The Overview showed the car + home banner with £38.14 and "Your home insurance costs less because you already insure your car with us."
- **E2E against staging** (`e2e.yml` by hand): 99 passed, and 16 stopped at the Turnstile captcha on sign-up and forgot password. Staging has the real Turnstile key, which blocks headless Chrome, and the workflow runs main's copy of the specs, which doesn't have `add-product.spec.ts` yet.
- **`add-product.spec.ts` against #108's preview** (Cloudflare's test key; run locally): passed in 1.2 minutes. Its first run timed out on the "Add home insurance" click, because the cookie bar covered the card at 390px; the spec now answers the bar first, as a visitor would.

## Commit message

`feat: add the other product from your account, with 8% off while you already hold one`

## Sources

- The 6.1b row in [phase.md](phase.md)
- Account · Overview `258:3602` (the add-product card under the policies; frame 02 draws "Add car insurance" on a car policy, and this slice offers the product they don't hold)
- 5.7b [07b-bundle.md](../05-quote/07b-bundle.md) for the rate, the split and the same-quote bundle this slice does not replace
