# 5.4b Journey revamp

**Status:** approved (Damion, 12 Nov 2026). Plan in [04b-journey-revamp-plan.md](04b-journey-revamp-plan.md)
**Phase:** 05-quote

## Goal

The car journey rebuilt to Damion's "Revamp" frames (Figma page `249:5806`, drawn after the 5.4 manual check). It changes how the journey looks and moves, not what it asks or what it charges. Every question, check, rule and price stays as 5.2–5.4 built them.

- **Why now** (Damion, 12 Nov 2026): the 5.4 manual check showed the journey works but doesn't feel guided. The revamp gives every step the same frame (where you are, what car this is, where to get help), so 5.5's cover, referred, declined and bundle screens are built once, in the new style, instead of twice.
- **The video shot:** a demo plate to "Your quote is ready" on a laptop, the "Your car" card following along and the details tabs ticking over, then the same at phone width.

## Decisions

1. **Its own slice, before 5.5** (Damion, 12 Nov 2026). 5.5 builds on it.
2. **The designs** (Damion, 12 Nov 2026) are the ten frames on the Revamp page, 1280 wide:

   | # | Frame | Node | Replaces |
   |---|---|---|---|
   | R01 | Choose your car (make → model → year → variant) | `249:5807` | screen 09 |
   | R02 | Your car, confirmed | `249:5858` | 5.2's confirmed-car view |
   | R03 | Tell us about you | `249:5907` | About you (`157:10429`) |
   | R04 | Your licence and driving | `249:5967` | screen 11 |
   | R05 | Your driving history, with an incident | `249:6028` | screen 12 |
   | R06 | Your driving history, no incidents | `249:6092` | screen 12 |
   | R07 | Who else will drive your car?, with a driver | `249:6143` | screen 12a |
   | R08 | Who else will drive your car?, nobody else | `249:6226` | screen 12a |
   | R09 | Your quote is ready | `249:6275` | 5.4's holding view |
   | R10 | Let's review your named driver | `249:6337` | 5.4's inline named-driver message |

   The registration screen (08) and "Vehicle not found" (10) have no Revamp frame; they move into the new frame as they are *(my call)*.
3. **The new style carries into 5.5** (Damion, 12 Nov 2026). Choose cover (13), referred (19, 03), declined (20, 04) and the bundle offer (21) aren't redrawn: 5.5 adapts them to this frame.
4. **The journey frame replaces the site chrome on `/quote`.** This reverses the 9 Nov decision that the quote pages use the live 3.1 header (Damion's frames, 12 Nov 2026).
   - **Header:** the wordmark (a link home), the four-step Stepper ("Your details · Your quote · Choose cover · Buy") and "Need help?".
   - **Footer:** one line, "Kerb is a fictional insurer made for a portfolio project. No real cover is sold.", with Privacy, Accessibility and Help.
   - **Which pages** *(my call, agreed in the playback)*: every page under `/quote`, so the start page, the car journey, home's holding page and coming soon all share it.
   - **No accessibility statement or help page exists yet.** "Need help?", "Contact us" and the footer's Help open `mailto:hello@kerb.opsedsolutions.com` (5.2's inbox), and Accessibility is left out until there's a page for it *(my call: no dead links)*.
   - **The demo notice bar stays** above the journey header, always shown and not dismissable, as on every public page (Damion, 12 Nov 2026). The footer line is as drawn as well.
   - **What else `SiteLayout` did that the frame keeps** *(my call)*: the skip link, `<main id="main">`, the `ClosureBanner`, and the Cookies link plus the "Cookie settings" button (without them a quote page has no way to change consent). The consent banner is in `__root` and is unaffected.
   - **The Stepper** shows on the car and home journey pages. The start page and coming soon show the header without it: the visitor hasn't started a journey yet *(my call)*. The Stepper moves out of `JourneyShell` into the frame, which works out the current step from the route and its `step` search value.

## Calls I've made (check these)

5. **The details tabs** (Car, About you, Driving, Claims, Drivers) sit under the heading on every "Your details" step.
   - A step that's done shows a tick and is a link back to it. The current step is filled. A step not yet reachable is plain text, never a link, so the 5.3 rule holds: no skipping past an unfinished step (5.3, call 5).
   - It's a `nav` with `aria-current="step"` on the current one.
   - They're the same steps as today's `step` search values plus the car; no route changes.
6. **The "Your car" card** sits in the right column on every car page, R01 to R10: make, model and variant, then year, fuel and doors, and the postcode.
   - **It follows the picker** (R01 draws it filled while choosing): it shows whatever's picked so far, so the picker's current selection is lifted out of `VehiclePicker` for the card to read. On the registration screen, before anything is picked, it shows the postcode only.
   - **"Change car or postcode"** does what 5.2's "Change" does today: it clears the stored car (`setVehicle(null)`) and opens the registration screen, which keeps its "Change" link for the postcode (to `/quote`, as `JourneyShell`'s link does now). The answers after the car stay in the tab.
7. **The help card** under it ("A little help along the way" on the details steps, "Need a hand?" on Your quote) carries each frame's own line and "Contact us".
8. **"Your car, confirmed" (R02)** follows any car chosen, from the picker or a demo plate. "Change car" does what "Change car or postcode" does (call 6); "Back" goes to the screen the car was chosen on (picker or registration); "Continue to your details" (today's plain "Continue", renamed) goes to About you. It is 5.2's confirmed-car view restyled, not a new step.
9. **Buttons:** "Back" (with an arrow, as a link-style button) on the left and a named primary button on the right on every step, as drawn ("Confirm this car", "Continue to your details", "Continue to your licence", "Continue to claims", "Continue to named drivers", "Get my car quote"). The registration screen's Back goes to `/quote`. The browser's back button still moves between steps (5.3, call 5).
10. **Your quote is ready (R09):**
    - "Your Comprehensive price", then "Choose how you'd like to pay": two cards, **Pay annually** (one payment, `£1,703.39 /year`, "Total payable £1,703.39") and **Pay monthly** (12 payments, `£156.14 /month`, "Total payable £1,873.68"), as one radio group. Annual is picked first.
    - **Monthly's total payable** is the 12 payments added up (the server's `monthlyPaymentPence` × 12, worked out in the browser), so it can differ by a few pence from annual × (1 + the version's `monthly_credit_charge_rate`). The figure is what the visitor actually pays *(my call)*.
    - **The choice is kept in the tab** with the journey (a new optional part, `payment: "annual" | "monthly"`), for 5.5's Choose cover and 5.6's Buy. It isn't sent to the server: it doesn't change the price.
    - **"Choose cover"** goes to 5.5's screen. Until 5.5 merges, it shows a holding line, "Choosing your cover arrives in 5.5" (staging only, as 5.1 did).
    - "Your details at a glance" keeps 5.3's summary rows and their Edit links. "Back to your details" goes to Named drivers.
    - The price is still announced to screen readers when it arrives or changes (5.4).
11. **Driver not covered (R10)** replaces 5.4's inline message when a named driver is the reason a quote is declined or referred (5.4, decision 14).
    - **Declined, as drawn:** heading "Let's review your named driver", intro "We can't offer cover with John as a named driver.", warning "We can't offer cover with John included" / "You can remove John to see a price without them, or review the details you entered."
    - **Referred** (no frame; my wording): same heading, intro "We need to check a couple of things before we can include John.", warning "We need to check a couple of things about John" / "You can remove John to see a price now, or review the details you entered." Both keep "What happens if you remove John?" and its explanation.
    - **"Remove John and see my price"** keeps 5.4's on-the-spot removal: John comes off, the quote is priced again and R09 shows, with "John has been removed from this quote. Add John back" above the price. "Add John back" restores him and returns to R10.
    - **If the next named driver then stops the quote,** R10 shows for them, with the "Add John back" line still above it. Only the latest removal can be undone, as 5.4 built it *(my call)*.
    - **"Review named driver details"** opens the Named drivers step.
    - A quote declined or referred for a reason that isn't a named driver keeps 5.4's plain line on R09's layout until 5.5 builds screens 19 and 20.
12. **Tablet and phone** *(my call, agreed in the playback)*: below the desktop breakpoint the right column drops under the form; on a phone the "Your car" card becomes one line above the form ("Tesla Model 3 RWD · E8 3RL · Change"); the details tabs scroll sideways with the current one in view; the Stepper shows the current step's name with "Step 2 of 4". Nothing clips or scrolls the page sideways at 360 px.
13. **Copy that names the visitor** (R03's "for the 2024 Tesla Model 3", R04's "about Damion Wilson") comes from the journey; a part not yet answered drops the clause rather than showing a blank.
14. **The frames' sample content isn't copied.** R03's address (Oshawa) and the sample names are placeholders.

## In scope

- **The journey frame:** the quote routes move from `_site` to a pathless layout route of their own (so every `createFileRoute` id changes, the URLs don't), with its own header and footer in place of `SiteLayout`.
- **Shared journey parts** in `src/features/quote/`: the details tabs, the "Your car" card, the help card, the two-column page layout, the Back / next button row.
- **Restyled steps:** registration and not-found (5.2), the picker (R01), the confirmed car (R02), About you, Licence and driving, Claims, Named drivers (R03–R08).
- **Your quote (R09)** with the pay choice, and **driver not covered (R10)**.
- **The journey store** gains the optional `payment` part (call 10).
- **Tests** updated where wording or structure changed, and the new ones below.
- **Docs:** `figma.md` gains a "Revamp" section listing R01–R10 and marks screens 09, 11, 12, 12a and the About you frame as replaced; `phase.md` gains the 5.4b row and records decision 4 next to the 9 Nov header decision; `build-plan.md` gains the 5.4b box.

## Out of scope

- **Any change to questions, checks, rules, prices or the server.** If a frame asks for something new, it's raised, not built.
- **Choose cover, referred, declined and bundle screens** (5.5, in this style).
- **Home steps** (5.7). Home's holding page only gets the new frame.
- **A help page or accessibility statement.** The links go to the inbox (decision 4).
- **Updating the Figma tablet and mobile frames** to the revamp (Damion, later, if wanted).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Component | Details tabs: done steps are links with a tick, the current one has `aria-current="step"`, a step past the first unfinished one isn't a link; clicking a done tab opens that step with its answers | yes |
| Component | "Your car" card shows the chosen car and postcode on every step from the confirmed car onwards, the postcode only before; "Change car or postcode" goes to the car step | yes |
| Component | R09: annual is picked first; picking monthly is kept in the journey and survives a refresh; monthly's total payable is 12 × the payment; the price is announced | yes |
| Component | R10: a declined named driver shows R10, not R09; "Remove John and see my price" prices again and shows R09 with "Add John back"; "Add John back" returns to R10; "Review named driver details" opens Named drivers | yes |
| Component | The existing 5.1–5.4 component tests pass, with only wording and structure updated | yes |
| E2E | 5.4's journey (Golf price, Tesla decline naming the driver) runs through the new frame; axe on every step at phone and desktop width | yes |
| Manual | On the PR preview at 1280 px, a tablet width and 393 px: a demo plate to R09; the picker route to R09; the Tesla with a 19-year-old to R10, remove and add back; the tabs and "Your car" card at each width; nothing overflows | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] Every 5.1–5.4 behaviour still works: prefills, can't skip ahead, answers kept going back, prices unchanged for the same answers.
- [ ] The manual check passes, with the results recorded here.

## Commit message

`feat: the car journey in the revamp's frame, with the journey header, details tabs, a "Your car" card on every step, the pay-annually-or-monthly choice and a named-driver review step`

## Sources

- **Figma:** the Revamp page (`249:5806`), frames R01–R10.
- **Plan:** phase.md's quote-start and 9 Nov decisions; 5.1 (shell, Stepper), 5.2 (car step views, call 9), 5.3 (steps, calls 5 and 17), 5.4 (decisions 4 and 14, `monthlyPayment()`).
- **Damion, 12 Nov 2026:** didn't like the journey's look in the 5.4 manual check; the revamp is its own slice before 5.5; 5.5's screens take this style without being redrawn; the demo notice bar stays on the quote pages.
