# 5.1 Quote start and flow shell

**Status:** done (PR #78; the manual staging check below is still open). Plan in [01-quote-start-plan.md](01-quote-start-plan.md)
**Phase:** 05-quote

## Goal

`/quote` becomes a real page. A visitor picks what they want to insure and gives a postcode, in either order, and lands in the car or home journey with a Stepper showing where they are. The five types Kerb doesn't sell yet get a friendly "coming soon" page that offers car or home instead. Nothing is saved on the server: a visitor's answers stay in their browser until the sign-in gate (4.2 decision 5).

- **Every entry point works:**
  - the hero's postcode form, now navigating inside the app instead of reloading the page;
  - the insurance types on the landing page;
  - the "Get a quote" buttons in "How it works" and the closing section;
  - a typed `/quote` link.
- **Either input can come first.** `?type=` picks the type, and `?postcode=` fills the postcode. Both stay editable, and a bad value in the link is dropped quietly.
- **The journey shell.** `/quote/car` and `/quote/home` show the Stepper and a slot that 5.2 (car) and 5.7 (home) fill. A visitor's progress survives a page refresh.
- **Works without JavaScript,** like the hero does today.

## Decisions

1. **Designs** (Damion, 9 Nov 2026). Screen 01, quote start (`222:6702`), and screen 02, coming soon (`222:6717`), in the "Quote · Phase 5 additions" set ([figma.md](../../figma.md)). Tablet and mobile adapt them, using the existing mobile journey's stepper and form layout.
2. **The live site header from 3.1,** not the header drawn in the frames (Damion, 9 Nov 2026).
3. **One Stepper for both journeys** (Damion, 9 Nov 2026): "Your details · Your quote · Choose cover · Buy". In the home journey, property, contents and past claims (screens 05–07) are the three parts of "Your details", and their eyebrows say "Step 1 of 3" and so on. Screens 05–07 draw a home-only Stepper; the build uses the shared one.
4. **"Retrieve a saved quote" is sign-in only** (Damion, 9 Nov 2026). The button links to `/quote/retrieve`, which 5.6 builds; until then it reaches the site's "not built yet" page, as unbuilt links do today.

## Calls I've made (check these)

5. **The routes:**

   | Route | Screen | What it does |
   |---|---|---|
   | `/quote` | 01 | Type picker and postcode, both pre-filled from the link |
   | `/quote/coming-soon` | 02 | `?type=` names the type that isn't sold yet; `?postcode=` is carried through |
   | `/quote/car` | shell | Stepper at "Your details", the postcode, and a slot for 5.2 |
   | `/quote/home` | shell | Stepper at its first step, the postcode, and a slot for 5.7 |

   - **Checking the link:** each route validates its search params with `postcodeSchema` and `isProductId`, the rules the landing page already uses. A bad or missing value is dropped (the field shows empty), never shown as an error.
   - **Missing postcode:** `/quote/car` or `/quote/home` without a valid postcode sends the visitor back to `/quote?type=car|home`.
6. **The type picker.**
   - **Layout:** a `RadioGroup` of seven cards in the order screen 01 draws them: Car, Home, Landlord, Pet, Condo, Business, Tenant. Car and Home carry an "Available now" badge, and the rest "Coming soon".
   - **The button follows the choice:**
     - "Continue with car" or "Continue with home";
     - "Continue" for a coming-soon type, which goes to screen 02;
     - "Continue" when nothing is picked yet.
   - **Postcode:** required for car and home, optional for a coming-soon type (screen 02 keeps it if given). Under a postcode that came from the link: "Added from your link. You can change it here."
7. **Without JavaScript the form still works.**
   - **The form:** a plain GET to `/quote` with a hidden `next=1`. The route sees `next=1` and redirects to `/quote/car`, `/quote/home` or `/quote/coming-soon` when the inputs are valid. Otherwise it shows the page again with the error, rendered on the server.
   - **With JavaScript:** the same checks run in the browser, and Continue navigates without a reload.
   - **Error copy:** the postcode error is the hero's own ("Enter your full postcode, like E8 3RL."). A missing type gets "Choose what you'd like to insure."
8. **The hero's submit becomes a router navigation** (phase row), to `/quote?postcode=E8+3RL`, the same URL as today, so it still works without JavaScript.
   - **The other links:** the insurance types, "How it works" and the closing section switch to TanStack `<Link>`s for `/quote` now that the route exists (`links.ts` explains why they were plain hrefs).
   - **The retrieve link:** `retrieveQuoteLink` reads "Continue a saved quote" on the landing page and "Retrieve a saved quote" on screen 01. Each keeps its own label; both go to `/quote/retrieve`.
9. **A visitor's answers live in `sessionStorage` until the sign-in gate.**
   - **Where:** one key per product (`kerb.quote.v1.car`, `kerb.quote.v1.home`) holding a versioned, Zod-checked object. 5.1 stores the postcode and when the journey started; 5.2 onwards add their answers.
   - **Why `sessionStorage`:** it survives a refresh but not closing the tab. A shared computer doesn't keep someone's driving history, and a fresh tab starts clean. The server stores nothing until 5.6.
   - **When it fails:** storage can be unavailable (some private modes). The journey then works for that page only, never crashes, and shows no warning.
   - **`quote_started`:** the existing PostHog event (3.5's A/B test) still fires from the hero, unchanged.
10. **The Steppers.**
   - **Both journeys:** "Your details · Your quote · Choose cover · Buy" (decision 3).
   - **Sizes:** the `default` variant on web and tablet, `bar` at phone width, as the mobile journey shows.
   - **Starting position:** 5.1 shows step 1 as current. The steps after it aren't links yet.
11. **`quote.started` goes into the `events` table** (engineering.md §13: the server-side funnel milestones).
    - **When:** a visitor reaches `/quote/car` or `/quote/home` from `/quote` or the coming-soon page.
    - **What it holds:** the product, the postcode **district** only (`E8`, for Phase 9's conversion by district), and PostHog's distinct id as `anonymous_id` when the visitor accepted cookies. No full postcode, nothing else. (Build: plus the tab's random journey id as `entity_type = 'quote_journey'`, `entity_id`, so a repeat writes nothing; [plan](01-quote-start-plan.md) P1.)
    - **Write limit:** it goes through a server function rate-limited by the 4.5c `limit()` (30 per IP per hour), so the funnel can't be flooded. Once per journey per tab, tracked in the `sessionStorage` object.
12. **TanStack Query waits for 5.2.** The phase row puts "`staleTime` per data type" in 5.1, but 5.1 fetches nothing, and adding the library with no query would be untested setup. 5.2's catalogue is its first real use. Intent preloading is already on for the whole router (`defaultPreload: "intent"`, `src/router.tsx`), so the quote links get it once they're `<Link>`s.
13. **The shells' slot reads "This step arrives in 5.2" (car) or "This step arrives in 5.7" (home).** Phase 5 reaches production only at its release, so no visitor sees the placeholder; staging does.

## In scope

- **Routes:** `src/routes/_site/quote.tsx` with `quote.index.tsx`, `quote.coming-soon.tsx`, `quote.car.tsx` and `quote.home.tsx` (names follow the existing `_site` layout), with search validation.
- **Feature code:** `src/features/quote/`:
  - `QuoteStart`, `TypePicker` and `ComingSoon`;
  - `JourneyShell`, which shows the Stepper and the slot;
  - `journey-store.ts`, the `sessionStorage` object and its schema;
  - the type list in screen order with badges, from `products.ts`.
- **Server:** the `startQuote` server function, which writes the `quote.started` event (limited), plus a data-layer write for `events`.
- **Landing:** the hero's submit becomes a router navigation; `links.ts` gets `<Link>` for `/quote`.
- **Docs:** `figma.md` (done on this branch), `phase.md` decisions (done), engineering.md §13 notes that `quote.started` is now recorded.

## Out of scope

- Every step's content: vehicle (5.2), driver (5.3), pricing (5.4), cover (5.5), pay and retrieve (5.6), home (5.7).
- Saving to the database, "Save and exit", and sign-in (5.6).
- The "Add home insurance" bundle screen (screen 21: 5.5 / 5.7).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | The search schemas: a valid postcode is normalised; a bad postcode or unknown type is dropped, not an error; `next=1` with valid inputs gives the right redirect target, and with bad inputs the right error. The `sessionStorage` object: round-trips, ignores a corrupt or old-version value, survives storage throwing | yes |
| Component | The type picker in real Chromium: seven cards in screen order with the right badges, arrow keys move the choice, the button label follows it ("Continue with home", "Continue"), the "Added from your link" hint only for a postcode from the link | yes |
| Integration | `startQuote` writes one `quote.started` event with the product, district and anonymous id and nothing else; the 31st in an hour from one IP is refused; a second call in the same journey writes nothing | yes |
| E2E | Hero postcode → `/quote` pre-filled → Car → `/quote/car` with the Stepper; `/quote?type=landlord` → coming soon → "Get a car quote" keeps the postcode; JavaScript off: the start form reaches `/quote/car`, and a bad postcode shows the error; a refresh on `/quote/car` keeps the postcode; axe on `/quote`, coming soon and a shell at phone and desktop width | yes |
| Manual | On staging at phone width and on a laptop: every entry point (hero, insurance types, "How it works", the closing section, a typed link) lands where it should; the Stepper's `bar` variant on a phone | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The manual check passes on staging, with the results recorded here before the PR is merged.

## Commit message

`feat: quote start with the type picker and postcode in either order, coming soon for the other five types, and the car and home journey shells`

## Sources

- phase.md 5.1 row, "Quote start", and the Decisions before the phase.
- figma.md "Quote · Phase 5 additions", screens 01 and 02.
- 3.2 (the hero form and `postcodeSchema`), 3.3 (`products.ts`), 3.5 (`quote_started`).
- 4.2 decision 5 (a guest's quote lives in the browser), 4.5c (`limit()`), engineering.md §13 (`events`).
