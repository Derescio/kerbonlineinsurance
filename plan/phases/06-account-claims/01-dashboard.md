# 6.1 Dashboard

**Status:** in progress (spec approved by Damion, 18 Nov 2026)
**Phase:** 06-account-claims

## Goal

`/account` becomes the customer's Overview, inside the account shell that the rest of Phase 6 builds on:
- **The shell:** the dark green account header from the Figma Account page (`177:2850`): Overview · Policies · Claims · Documents, the bell, and an initials avatar with a menu.
- **The Overview:** a greeting, stat cards, and the customer's policies, with car and home shown by what they insure (plate and car, or the address), not only by reference.
- **The public header** says "My account" when someone is signed in, without uncaching the public pages.
- **Housekeeping from 4.5:** two combined indexes and one `Actor` per request.
- **Screen 21's heading** when a home quote is already ready (Damion's production check, 18 Nov 2026).

**Why:** `/account` is still 5.6's stopgap page: a greeting, a policy list, then login methods, 2FA and close account stacked underneath. Every Phase 6 page (policy detail, settings, claims) hangs off this shell, so it comes first.

Adding a product later, with the 8% saving, is **6.1b** (split from this row on 18 Nov 2026, agreed with Damion). 6.1 leaves a place for its card.

## What exists already

- **`/account`** ([account.tsx](../../../src/routes/account.tsx), [AccountPage.tsx](../../../src/features/auth/AccountPage.tsx)): a guard (`requireSignedIn`, `getAccountSummary`), `private, no-store`, and `listMyPoliciesFn`. The page has the 4.3 dark header with Log out, `ClosureBanner`, "Your policies" (bundles grouped under "Car + home bundle" with the saving, a lapsed badge, the "Update your payment card" link for a Stripe subscription), Ways to log in, Two-factor and Close account.
- **`listMyPolicies`** ([policies.ts](../../../src/server/data/policies.ts)): reference, product, cover level, status, dates, `monthly` and `bundle`. It has no car or address, so rows can only show a reference.
- **Payments:** `payments` rows carry `due_on`, `amount_pence`, `status` and the Stripe subscription id. Nothing reads "the next payment" yet.
- **Figma (Account page, `177:2850`):** Policy overview (`183:3507`, 6.2), the six "Make a change" dialogs (`183:3784`, 6.3) and Account settings (`182:3249`, 6.3) all use the same header. `Acct / Header` (`181:3310`) and `Plate` (`181:3317`) are local components there. **Account · Overview** (`258:3602`, drawn for this slice on 18 Nov 2026): 01 Overview (`258:3608`), 02 one lapsed policy (`258:3635`), 03 no policies yet (`258:3659`), 04 avatar menu (`258:3683`).
- **`ui_kits/web/Dashboard.jsx`:** the older mock. Its content is used (greeting, stats, a policies list, a claims card); its layout gives way to the Figma Account set.

## Decisions

1. **One shell, built once.** An `AccountShell` component: the header from `Acct / Header`, then the page. Every page under `/account` uses it from now on. The existing 4.3 auth pages keep their own frame.
   - **Tabs appear with their pages.** 6.1 shows Overview only. Policies and Documents arrive with 6.2, and Claims with 6.4. No tab leads to a page that doesn't exist yet. *(my call)*
   - **The bell** waits for notifications (6.6). The frames draw it, but it isn't shown until it does something.
   - **The avatar menu:** "Account settings" and "Log out". Initials from the user's name, as in the Figma.
2. **Settings move off the Overview.** Ways to log in, Two-factor and Close account move as they are to `/account/settings`, inside the shell, behind the avatar menu. 6.3 rebuilds that page to the Account settings frames. *(my call: the Figma Overview has no room for them, and 6.3 owns their design)*
3. **The greeting:** today's date (Europe/London, "Tuesday 18 November") over "Hi {first name}, you're covered." when at least one policy is active or starting later; otherwise "Hi {first name}" (frames 02 and 03: a lapsed policy alone isn't cover). The 4.4 greeting ("Good morning") goes.
4. **Stat cards, from data that exists.** A policy **held** here means active, starting later or lapsed: a lapsed policy restarts when the card is updated (5.6b), so it still counts (frame 02). Cancelled and ended policies don't count. No policies held → no stat cards (frame 03).
   - **Policies:** the number held.
   - **Next payment:**
     - **Overdue** (frame 02): an unpaid payment whose due date has passed shows "Payment due" in amber, with "£44.70 outstanding" (the total of overdue payments).
     - **Otherwise** (frame 01): the earliest unpaid payment due today or later, as "£44.70" over "on 1 Dec".
     - **None** (an annual payer): "All paid for this year".
     - A "Manage payments" link opens `/account/billing` (a full page load, as now) when the customer has a Stripe subscription. It replaces the per-policy "Update your payment card" link. *(my call)*
   - **A year:** the sum of the held policies' annual premiums, after any bundle saving, with "after your £96 bundle saving" when there is one.
   - **Open claims** is drawn in frames 01 and 02, but it's added in 6.6. Until then the row has three cards, which share the width.
5. **Policy rows say what's insured.** Car: the plate (the `Plate` component) and "{make} {model}". Home: the address's first line and town. Then cover level, a status badge ("Active", "Starts 3 Dec", "Lapsed" in warning, "Cancelled", "Ended") and "Renews {date}" or "Ended {date}". A lapsed row has no date; under the cover level it says "Your payment didn't go through. Update your card to restart your cover." (frame 02). Bundles stay grouped, with the saving. Rows aren't links until 6.2 builds policy detail, so no chevron yet. "Your saved quotes" stays as the section's button.
   - **Data:** `listMyPolicies` gains a `label` (`{ kind: "car", plate, make, model }` or `{ kind: "home", line1, town }`), read through the quote item's `vehicles` or `properties` row. It's the customer's own data, behind the same `customerId` filter.
6. **No policies yet** (frame 03): no stat cards; the policies card says "You don't have any policies yet." with "Get a quote" (to `/quote`), and "Your saved quotes" stays as the card's button.
7. **The add-product card** drawn under the policies is 6.1b. 6.1 doesn't show it. (Frame 02 offers "Add car insurance" to a customer who holds car; 6.1b offers the product they don't hold.)
8. **"My account" in the public header** (from the 6.1 row, Damion, 12 Nov 2026):
   - **The problem:** the public pages are CDN-cached (4.4, decision 7), so the header can't know who's signed in.
   - **The check:** after load, the header asks `GET /api/session-hint`, which is uncached (`private, no-store`) and returns `{ signedIn: boolean }` from the session cookie, with no database read beyond Better Auth's session lookup.
   - **What changes:** when signed in, "Log in" becomes "My account", a menu with "Overview" and "Log out".
   - **No flicker:** the slot keeps its width while the check runs. On mobile the menu panel gets the same two links.
9. **Perf (from 4.5):**
   - A migration adds `policies (customer_id, created_at)` and `claims (customer_id, created_at)`.
   - The `Actor` is built once per request (a per-request memo), never cached across requests, so a deactivation still applies on the next one.
10. **Screen 21's heading** (Damion's production check, 18 Nov 2026): when the tab already holds a finished home quote, `AddHome` reads overline "Your car quote / Your home quote", title "Your car and home quotes are ready", intro "See them side by side with the saving for having both. You can still buy car insurance on its own." Already written and tested on this branch.

## In scope

- `AccountShell`, the avatar menu, `/account` as the Overview, `/account/settings` holding the moved sections
- `listMyPolicies` with `label`; a `getMyNextPayment` read; the Overview's stat cards and policy rows
- `/api/session-hint` and the public header's "My account"
- The index migration and the per-request `Actor` memo
- Screen 21's heading

## Out of scope

- Adding a product later and the multi-policy saving: **6.1b**
- Policy detail, documents and the Policies and Documents tabs: 6.2
- Account settings' real design, personal details, notifications and payment methods: 6.3
- Claims, the Claims tab, "Start a claim", the Open claims stat and the bell: 6.4–6.6
- Renewals and the "Review renewal" alert: no slice yet
- Mobile and tablet frames: the shell and Overview adapt the web frame, as Phase 5 did

## Tests

| Layer | What |
|---|---|
| Integration | `listMyPolicies` returns a car label and a home label only for the customer's own policies; `getMyNextPayment` returns the overdue total when a payment is past due, otherwise the earliest unpaid future payment; it ignores paid and other customers' rows, and returns none for an annual payer |
| Integration | `/api/session-hint` returns `signedIn: true` with a session and `false` without one, with `private, no-store` |
| Integration | The per-request memo builds the `Actor` once for a page that calls several server functions; a staff member deactivated between two requests is refused on the second |
| Component | Overview: greeting with and without an active policy; stat cards for a monthly payer, an annual payer, an overdue payment ("Payment due") and no policies (no cards); a lapsed policy counted in Policies and A year, with its row message and no date; car and home rows with their status badges; a bundle grouped with its saving; the empty state; "Manage payments" only with a subscription |
| Component | Account shell: Overview tab current; avatar menu opens, closes on Escape, and links to settings and log out |
| Component | Public header: "Log in" until the hint answers, then "My account" when signed in; the slot's width doesn't change |
| Component | Screen 21: the heading reads "Your car and home quotes are ready" with a ready home (done) |
| E2E | Buy a car policy → `/account` shows the plate, the car, "Active" and the next payment; the public home page then shows "My account"; axe on `/account` and `/account/settings` |

## Done when

- `/account` matches frames 01–04 (without the bell, Open claims and the 6.1b card), at desktop and phone width.
- Settings sections work from `/account/settings` as they did on `/account`.
- The public header shows "My account" when signed in, with the pages still cached.
- The migration has run on dev, and the tests above pass in `ci`.
- Preview manual check by Damion.

## Commit message

`feat: your account's overview, with the account header, your policies by car and address, your next payment, and "My account" in the site header when you're signed in`

## Sources

- Figma Account page `177:2850`: `Acct / Header` `181:3310`, `Plate` `181:3317`, Policy overview `183:3507` (the stat cards' style), Account settings `182:3254`; Account · Overview `258:3602` (frames `258:3608`, `258:3635`, `258:3659`, `258:3683`)
- `ui_kits/web/Dashboard.jsx` (content only)
- The 6.1 row in [phase.md](phase.md)
