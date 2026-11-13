# 5.6 Pay, policy saved, retrieve a quote

**Status:** done (#91, approved by Damion, 13 Nov 2026); manual check pending
**Phase:** 05-quote

## Goal

A priced car quote becomes a real policy:
- **The sign-in gate.** A guest who presses Buy signs in or creates an account first (screens 14 and 15), and their quote and cover choice are kept.
- **The save.** Their quote is saved with `saveQuote()` (5.4).
- **Confirm and pay.** They pay with a fake card on "Confirm and pay" (the `Quote & Policy` Purchase frame).
- **You're covered.** They land on screen 18. The policy shows on `/account`.
- **Retrieve.** A signed-in customer can open "Your saved quotes" (screen 17) and carry on.

- **The video shot (the phase's payoff):** complete a quote at phone width, create or sign in to an account, pay, land on "You're covered", then show the policy row in Neon.
- **Why the save comes at the gate:** a guest's quote lives in the tab until here (4.2, decision 5; 5.1, call 9). From this slice the server holds it, and Buy works from the saved quote, not the tab.

## Decisions

1. **Creating an account saves the quote on the server, against the new account** (Damion, 13 Nov 2026, option A).
   - **The problem:** since 4.4b a new account must confirm its email before it can sign in. The confirmation link opens in a new tab or on another device, and the tab's quote would be lost.
   - **What happens:** "Create account" on screen 15 sends the journey and cover choice with the sign-up. When Better Auth creates a **new** user, the same request creates their customer row (decision 4) and saves the quote (decision 5). After confirming, they sign in, and the quote is waiting on "Your saved quotes" on any device. Screen 15's line already says so: "Confirm your email after signing up, then return to payment."
   - **Only a user this sign-up created gets the quote.** A sign-up for an email that already has an account (the response looks the same, so no enumeration) attaches nothing. The quote stays in the tab, and the existing-account email Better Auth already sends tells them to log in. That includes a second sign-up for an email still waiting to be confirmed: Better Auth treats it as an existing user. The quote from the first sign-up is already on that account.
   - **If the save fails,** the account is still created and the failure is logged. Sign-up never fails because of the quote *(my call)*. The browser can't tell the difference, but the tab still holds the quote, so signing in here and pressing Buy saves it again.
   - **Accounts never confirmed are cleaned up** *(my call; nothing does this today)*. A daily job (4.10's runner) deletes users whose email is still unconfirmed 7 days after they signed up, and their customer and quotes go with them by cascade. It's a plain delete, not 4.7's path (which needs a signed-in owner): an account that never signed in can hold nothing else. Staff are never touched. Seven days, not the link's 6 hours, so "resend the link" still works the next day.
   - **Google and password sign-in stay in the tab.** Google's round trip returns to the same tab, and sign-in (with two-factor if it's on) is a redirect within it. Both come back to `step=buy` signed in, and the save runs there.
2. **Where it sits.**
   - **`/quote/car?step=buy`, the gate.** It's reached from screen 21's "Continue with car only" (replacing 5.5's holding line) and from "Save and exit" (decision 13). The Stepper shows step 4, "Buy". It's guarded like `step=cover`: only a quoted journey with a chosen tier reaches it.
     - **A guest sees screen 14, sign in,** with a link to screen 15, create account, and back. The two are one step with a `?auth=signup` switch *(my call)*.
     - **A signed-in visitor never sees the gate.** The step saves the quote and goes on to pay, showing "Saving your quote…" meanwhile.
   - **`/quote/pay/$quoteId`, Confirm and pay.** Signed-in only (a guest goes to `/login?redirect=…`), and only the owner's quote. Anyone else's, or a missing one, is the site's not-found page. It reads the saved quote, not the tab, so it also works from "Your saved quotes".
   - **`/quote/covered/$quoteId`, You're covered** (screen 18). The same access rules. It shows the policies bought from that quote.
   - **`/quote/retrieve`, Your saved quotes** (screen 17). Signed-in only. A guest goes to `/login?redirect=/quote/retrieve`. 5.1's "Retrieve a saved quote" button already links here.
   - **All four use 5.4b's journey frame.** The two `/quote/pay` and `/quote/covered` pages show the Stepper on "Buy". Retrieve has no Stepper.
3. **The gate screens (14 and 15), adapted.**
   - **The forms are 4.4's own.** `LoginForm` (Google, email, password, "Forgotten your password?") and `SignUpForm` (full name, email, password, the terms box, Turnstile) are reused, given `redirectTo` = this step. Screen 15's extra line "We only use these details to run your account…" is added under the terms box.
   - **The headings, as drawn:** "Sign in before you pay" / "Create your account to continue", with "Welcome back" / "New to Kerb?" on the card.
   - **The intro line changes.** "Your quote and selected cover are saved" isn't true before the gate, so it reads "We'll save your quote and selected cover when you sign in. You'll review your payment details next." On screen 15: "…when you create your account."
   - **The "Your cover is waiting" card:** the car, the plate (if a demo plate found it), the tier, the price for the chosen payment (as 5.5's cards show it) and the total excess. It ends with "No payment is taken when you sign in or create an account." The "Quote saved" badge and "Cover starts" line are left out, because neither is true yet (decision 8).
   - **The buttons:** "Sign in and continue to payment", "Create account", and "Back to choose cover".
   - **After creating an account,** the step shows 4.4b's "Check your inbox" panel with one added line: "Your quote is saved to your new account. Confirm your email, sign in, and you'll find it under Your saved quotes."
4. **The customer row** is made at a user's first saved quote (4.2, decision 4), from About you: first and last name, date of birth, address lines, town, and the journey's postcode. Phone stays empty. A customer who already has a row keeps it unchanged: the details on a later quote live on that quote's driver rows, and 6.3 edits the customer *(my call)*.
5. **Saving the quote.**
   - **The function:** `saveCarQuote`, a `defineWrite` with a rate limit (`quote.save`, 20 an hour) and an idempotency key from `useIdempotencyKey`, as 4.5c set up.
   - **The server prices the journey again** with the chosen cover, exactly as `priceCar` does: it re-checks the journey, takes the car's value and group from the catalogue, and uses the active rating version. Then `saveQuote()` writes it with every tier, every add-on, the selection, the factors and the decision (5.5's phase row). The browser's prices are never trusted.
   - **The car is checked again (phase row).** If `vehicle.catalogueVariantId` is no longer active, the answer is `{ status: "invalid", step: "car" }`. The tab goes back to the car step with "This car is no longer available on Kerb. Choose your car again." Any step that no longer passes goes back to that step, as `priceCar` does.
   - **One save per quote, not per click** *(my call)*. The tab keeps `saved: { quoteId, key }`, where `key` is a hash of the journey and cover. Buy, or Back then Buy, with nothing changed reuses the saved quote. A changed answer saves a new one, and the old one stays on "Your saved quotes" until it expires.
   - **`saveQuote()` is changed to run inside a given transaction**, so the customer row, the quote and the idempotency record commit together. It's the only caller change. The seed keeps its own transaction.
   - **A referred quote is saved as well** (decision 11). A declined one isn't: there's nothing to buy or review.
6. **Confirm and pay** (Purchase frame, `157:11256`, in 5.4b's frame).
   - **The heading and intro:** "Confirm and pay", "Review your payment details, check your cover and complete the purchase."
   - **"When should your cover start?"** A date field, defaulting to tomorrow, from today up to 30 days ahead *(my call; UK insurers allow up to about 30)*. The start date doesn't change the price: ages and licence years are worked out at today, and only grow by the start date.
   - **"How would you like to pay?":** 5.4b's annual and monthly cards, starting on the plan the tab chose (or annual from Retrieve). The amounts come from the saved quote: the selected option plus selected add-ons, through `quoteTotals()` and `monthlyPayment()`.
   - **"Payment card":** name on card (starting from the policyholder's name), card number, expiry (MM / YY) and security code. It's checked in the browser and again on the server: a Luhn-valid number of 13–19 digits, an expiry this month or later, a 3- or 4-digit code.
   - **The summary card, as drawn:** the tier and "Selected", then policyholder, vehicle, total excess, cover starts, the annual or monthly payment, and IPT included.
   - **Two tick boxes,** because the schema has a timestamp for each (`detailsConfirmedAt`, `coverAcknowledgedAt`): "I confirm my details are correct" and "I agree to the policy terms and understand my cover". The frame draws one line *(my call)*.
   - **The button:** "Pay £458.40" (annual) or "Pay £42.02 today" (monthly: the first payment).
   - **The demo cards,** listed under the card form, since the notice bar already says no real cover is sold *(my call)*: `4242 4242 4242 4242` succeeds, and `4000 0000 0000 0002` is declined with "Your card was declined. Try another card." Any other valid number succeeds.
   - **"Back to choose cover"** returns to `step=cover` when the tab still holds this quote. From Retrieve, it goes back to "Your saved quotes".
7. **Paying: `payForQuote`.** A `defineWrite` with a rate limit (`quote.pay`, 10 an hour) and an idempotency key, so a double click or a retry makes one policy (phase row). Inside its one transaction, in this order:
   1. **Lock the customer row** (`SELECT … FOR UPDATE`) and check `getAccountState`. A closing or closed account is refused with "Your account is closing, so you can't buy a policy." This is 4.7's note: a purchase racing an immediate delete would otherwise hit `RESTRICT`.
   2. **Lock the quote** and check it:
      - **Not the customer's own:** not found.
      - **Already accepted:** "You've already bought this quote", with a link to its "You're covered" page.
      - **`validUntil` has passed:** "This quote has expired. Get a new quote to see today's price."
      - **Status isn't `priced`:** "This quote can't be bought online."
   3. **Write the policies.** One policy per quoted item with a selected option. Each has a reference `KRB-` + six digits from 100000–899999, below the seed's 9 range (4.9, call 19), retried on a clash as `saveQuote()` does. It carries the selected option's cover level and compulsory excess, the item's voluntary excess, and `annualPremiumPence` (the item's annual total with add-ons, before IPT, as the option row stores it). It starts on the chosen date and ends a year later, less a day (15 Mar 2026 → 14 Mar 2027, as screen 18 draws). `termsAcceptedAt` is now.
   4. **With more than one item, write a `bundles` row first** and point each policy at it. The car journey never has two items until 5.7, so this path is tested with a saved sample home-and-car quote.
   5. **Write the payments.** Annual: instalment 1 for the annual total, `succeeded`, paid now. Monthly: instalment 1 `succeeded` now, and 2–12 `scheduled`, due monthly from the start date. Card brand and last four only.
   6. **Update the quote:** `accepted`, the payment plan, both confirmation times, and each item's `start_date` set to the chosen date.
   7. **Audit `policy.purchased`** for each policy (a new action, entity type `policy`). It records the quote reference, plan and amount, never card details.
   8. **Queue the confirmation email** (decision 9) in the same transaction, through 4.10's outbox.

   **Failure handling:**
   - **A declined demo card** returns `rejected` before anything is written, so it leaves no payment row *(my call: a failed fake payment isn't worth recording)*.
   - **A failure anywhere else** rolls everything back: no policy, bundle, payment, audit row or email (phase testing row).
   - **The card number and security code** are never stored, logged or audited.
8. **The cover start date** is chosen on Confirm and pay, so the save stores tomorrow as the item's start date and payment overwrites it. That's why screens 14 and 15 don't show "Cover starts" *(my call)*.
9. **You're covered** (screen 18, adapted).
   - **As drawn:** the "Payment successful" badge, "Car insurance · Purchase complete", "You're covered", and "Thanks, {first name}. Your {tier} car insurance is confirmed." Then the card with the car, the plate and tier, the policy reference, cover starts, cover ends, total excess, and the payment line ("£458.40 paid annually · Visa ending 4242", or "£42.02 paid today, then 11 monthly payments of £42.02 · Visa ending 4242"), with the excess spelled out.
   - **Left out until 6.2:** "Your policy documents" and "View policy".
   - **The email line** reads "A confirmation has been sent to {email}. You can also see your policy in your account." The email (a new template, `policy_confirmed`) carries the policy reference, the car, the dates and the amount, with a link to `/account`.
   - **"Go to my account"** goes to `/account`.
   - **The tab's car journey is cleared** after a successful payment, so a shared computer doesn't keep it *(my call)*.
10. **Your saved quotes** (screen 17), newest first, the customer's own only.
    - **A card per quote:** the car (make, model, variant), then the plate, tier and quote reference, with a badge by state:

      | State | When | Shows |
      |---|---|---|
      | Ready to buy | `priced` and in date | the annual price and the monthly line, "Price saved for 30 days from issue, provided your details stay the same.", and "Continue quote" → Confirm and pay |
      | Under review | `referred` | "We need to check a couple of things before we can offer cover." No button: the review status is 6.11's *(my call)* |
      | Bought | `accepted` | "Policy {reference}", and "Go to my account" |
      | Expired | `validUntil` passed and not accepted | "This quote's saved-price period has ended. Get a new quote with your current details." and "Start a new quote" → `/quote?type=car&postcode=…` |

    - **The prices come from the saved rows,** so a newer rating version never changes them (5.4's integration test).
    - **No saved quotes:** "You don't have any saved quotes yet." and "Get a quote".
    - **The eyebrow** is "Saved quotes · {first name last name}", from the customer row.
11. **"Sign in to send this for review"** (screens 19 and 03, replacing 5.5's holding line) runs the same gate and save for a referred quote, then lands on "Your saved quotes", where it shows "Under review". That saved row is what 6.11's queue reads (5.4, decision 2).
12. **The policy on `/account`** (phase row: "policy on the dashboard"). Until 6.1's dashboard, the account page gains a "Your policies" section from `listMyPolicies` (4.5): reference, product and tier, status, and start and end dates. It also gains a link, "Your saved quotes". 6.1 replaces the section.
13. **"Save and exit"** (left to 5.6 by 5.2's spec) appears on Your quote and Choose cover only, where there's a price to save. It runs the gate and the save, then goes to "Your saved quotes". Earlier steps have nothing priced to save, so it isn't offered there *(my call)*.
14. **The public header's "Log in" stays as it is.** The signed-in header is 6.1's.

## In scope

- **Routes:**
  - `step=buy` on `/quote/car`, with `auth=signup`.
  - `/quote/pay/$quoteId`, `/quote/covered/$quoteId` and `/quote/retrieve`.
- **Server:**
  - `saveCarQuote` and `payForQuote` (`defineWrite`), and a sign-up hook that saves the quote for a new user.
  - The `quote.save` and `quote.pay` rate rules in a new `rate-limit-rules.ts` (4.5c).
  - `saveQuote()` taking a transaction.
  - Reads for "Your saved quotes", the pay page and You're covered (`defineRead`, owner-only).
  - The `policy.purchased` audit action and the `policy_confirmed` email.
  - The daily cleanup of unconfirmed accounts.
- **Feature code:**
  - the gate with screens 14 and 15
  - Confirm and pay
  - You're covered
  - Your saved quotes
  - "Save and exit"
  - the referred screens' button
  - the `saved` journey part
  - `/account`'s "Your policies" section
- **Docs:**
  - `figma.md`: screens 14, 15, 17 and 18 and the Purchase frame marked built in 5.6, with the changed copy.
  - `phase.md` and `build-plan.md`: marked done.
  - `engineering.md`'s rate-limit row: the two new rules.

## Out of scope

- **The home journey and buying a home or bundle quote from it** (5.7). The bundle path in pay is built and tested here.
- **Policy documents, "View policy", the dashboard and the signed-in header** (6.1, 6.2).
- **The review status page and the handler queue** (6.11).
- **Real payments, refunds, and collecting the scheduled instalments.** Nothing takes instalments 2–12.
- **Retrieving a quote by emailed link** (screen 16, not built).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | Card checks (Luhn, expiry this month or later, code length); policy end date (a year less a day, including 29 Feb); the monthly schedule (12 rows, the first now, the rest a month apart from the start date, amounts summing to total payable); the saved-quote key changes with any answer or cover choice and not with `lastPlate` | yes |
| Integration | `saveCarQuote`: creates the customer once and keeps it on a second quote; re-prices on the server (a tampered price in the request changes nothing); a withdrawn car answers `invalid` / `car`; the same key replays one quote; the 21st save in an hour is refused | yes |
| Integration | Sign-up hook: a new user gets a customer and the quote; an existing confirmed email gets nothing; a failing save still creates the account; the cleanup deletes a user unconfirmed for 7 days with their quote, and keeps a confirmed one | yes |
| Integration | `payForQuote` (phase row): a double submit with one key makes one policy and one set of payments; a failure part-way (forced after the policy insert) leaves no policy, bundle, payment, audit row or outbox email; expired, referred, already accepted and another customer's quote are refused; a closing account is refused; a two-item quote writes one bundle and two policies; annual writes one payment and monthly twelve; no card number or code reaches the database or the log | yes |
| Integration | "Your saved quotes" lists only the user's own quotes, with each state's badge; a saved price is unchanged after a new rating version | yes |
| Component | Gate: a guest sees sign in and can switch to create account; the waiting card shows the chosen tier, price and excess; a signed-in visitor goes straight to saving. Pay: the start-date limits, the card errors, both boxes required, the button amount for annual and monthly, the declined-card message. You're covered and Saved quotes: the copy and buttons as decided | yes |
| E2E | Car quote → Buy → sign in (an E2E user) → pay monthly with `4242…` → You're covered → `/account` lists the policy, at 390 px (`e2e/buy.spec.ts`). Retrieve: the saved quote shows "Bought". Axe on the gate, pay, You're covered and Saved quotes at 390, 768 and 1440 px | yes |
| Manual | On the PR preview: the video shot at phone width; create an account mid-quote, confirm on another device, find the quote under Saved quotes and buy it; the policy row in Neon | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` and `e2e` are green on the PR.
- [ ] The manual check passes, with the results recorded here.

## Commit message

`feat: buy your car quote, sign in or create an account without losing it, pay with a demo card, land on You're covered with the policy on your account, and find your saved quotes`

## Sources

- **Plan:** phase.md, the 5.6 row and its testing rows; 4.2 decisions 4, 5 and 19; 4.5c (the write tools); 4.7's closure note; 4.9 call 19 (references).
- **Figma:** screens 14 (`226:714`), 15 (`226:729`), 17 (`226:759`) and 18 (`226:774`); the `Quote & Policy – Web` Purchase frame (`157:11256`); 5.4b's frame.
- **Earlier slices:** 5.4 (`saveQuote()`, `quoteTotals()`, `monthlyPayment()`); 5.5 decisions 8, 9 and 11; 4.4 and 4.4b (sign-up, confirming email, `replace-unverified`); 4.10 (the outbox and daily jobs).
- **Damion, 13 Nov 2026:** creating an account saves the quote on the server against the new account (option A).

## Notes from the build

- **Task 4, the sign-up probe:** Better Auth keeps the extra `quote` field on the `/sign-up/email` body, so `user.create.after` reads `ctx.body.quote` directly; the `AsyncLocalStorage` fallback was not needed. The cleanup also skips users with a closure row (closed accounts are set unconfirmed and keep RESTRICT rows).
- **The sign-up's quote save runs after the response** (Task 4), through the same deferred work as the account emails (Vercel's `waitUntil`), so a new email's answer takes no longer than a taken one's (4.4b). Decision 1's "the same request" still holds: it's the sign-up request's own work, just not awaited.
- **A referred quote, or one with no cover chosen yet, is saved at Comprehensive with the chosen extras** (Save and exit and "Sign in to send this for review" leave from Your quote).
- **Copy the decisions didn't give** (Tasks 6 and 7): "Your car insurance" as the heading while the price or session loads and while saving; "We couldn’t save your quote"; the gate's switch links "Create an account" and "Sign in"; "Back to your quote" on the way to Your saved quotes; "Cover start date" over the date field, with "From today up to 30 days ahead." and "Choose a start date from today up to 30 days ahead."; "Go to You’re covered" under "You’ve already bought this quote."
- **Your saved quotes' monthly line** is screen 17's: "Or 12 payments of £X · Includes Insurance Premium Tax".
- **The rate rules live in `src/server/data/rate-limit-rules.ts`**, not `src/server/db/` as engineering.md said; engineering.md now says so.
- **The E2E creates its account at the gate** rather than signing in a ready-made E2E user, so it also covers decision 1, and it confirms the email in the database (`e2e/db.ts`, shared with 4.7's delete test). Its address is `delivered+e2e-buy-<time>@resend.dev`. The gate's two halves are also in `e2e/a11y.spec.ts` for a guest.
