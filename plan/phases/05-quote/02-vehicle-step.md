# 5.2 Vehicle step

**Status:** approved (Damion, 9 Nov 2026), building. Plan in [02-vehicle-step-plan.md](02-vehicle-step-plan.md)
**Phase:** 05-quote

## Goal

The car journey's first real step. A visitor finds their car by its registration or by choosing make → model → year → variant from the 4.8 catalogue, checks the car card, and confirms it. Kerb is a demo, so the registration lookup only knows a short list of made-up demo plates, and screen 08 shows that list. Any other plate gets "We don't have that car" and the dropdowns. A car that isn't in the catalogue gets a friendly message with an email link. The postcode from `/quote` is checked against postcodes.io before the car step opens, and each postcode is looked up once.

- **The video shot:** type (or tap) a demo plate, press "Find my car", and watch make, model, year and variant fill in one after another, with the car card underneath.
- **A real visitor never gets stuck.** Their real plate isn't recognised, so they go to the dropdowns. A car that's missing from those gets the "Kerb is a demo" message.
- **Nothing is saved on the server.** The chosen car joins the tab's journey object (5.1, call 9) until the sign-in gate in 5.6.

## Decisions

1. **Designs** (Damion, 9 Nov 2026). Screen 08, enter registration (`226:624`); screen 09, manual picker (`226:639`); screen 10, vehicle not found (`226:654`), in "Quote · Phase 5 additions" ([figma.md](../../figma.md)). Tablet and mobile adapt them with the existing mobile journey (phase decision).
2. **The registration box is open to everyone** (Damion, 9 Nov 2026). No sign-in is needed, as on real UK insurance sites. "Use my car from last time" for a signed-in customer is a later idea: nothing stores a customer's car until 5.6.
3. **The plate lookup is faked against demo plates** (Damion, 9 Nov 2026). A real insurer buys every UK plate's details from a data company. Kerb has a fixed list of made-up plates, each tied to one catalogue car. The DVLA's free Vehicle Enquiry Service (make, year, fuel, engine size and colour, but no model or variant) is a possible later upgrade, not part of 5.2.
4. **The demo plates are shown on screen 08** (Damion, 9 Nov 2026). It's a portfolio piece, and a real visitor shouldn't have to guess which plates work.
5. **A car that isn't listed** (Damion, 8 Nov 2026, from 4.8 decision 2). The message says Kerb is a demo with a limited list of cars, suggests picking another car, and gives `hello@kerb.opsedsolutions.com` to ask for a make to be added. Damion confirmed that inbox receives mail (5.1 follow-up, PRs #80 and #81).

## Calls I've made (check these)

6. **The demo plates.**
   - **The list:** six plates, each tied to a popular car from a different make: a Ford Fiesta, Volkswagen Golf, Vauxhall Corsa, Toyota Yaris hybrid, Tesla Model 3 and BMW 3 Series. They live in code (`src/features/quote/demo-plates.ts`) as plate → `(make, model, year, variant)`. A test checks that each one names an active catalogue row.
   - **Believable but never real:** each plate's age identifier matches its car's year (a `24` plate is a 2024 car). The last three letters include an I or a Q, which the DVLA never issues in that position, so a demo plate can't belong to a real car.
   - **How they're shown:** under the box, "Kerb is a demo, so only these plates are recognised:", followed by the six plates as buttons in the plate style. Tapping one fills the box. It doesn't search until "Find my car" is pressed, so the viewer sees the plate go in first.
   - **Figma:** screen 08's example `KR24 BXL` becomes the box's placeholder only.
7. **The lookup happens in the browser.** The demo list and the catalogue are both already in the page, so "Find my car" sends nothing to the server, and a visitor's real plate never leaves their browser.
   - **Matching:** case and spaces are ignored (`kr24bxq` matches `KR24 BXQ`).
   - **Errors:** an empty box gets "Enter your registration." Any other text that isn't a demo plate goes to screen 10.
8. **The fill-in.** After a demo plate matches, the picker (screen 09) opens with the eyebrow "Car · Your details" instead of "Manual lookup". Make, model, year and variant fill one after another, about 200 ms apart, and then the car card appears. With `prefers-reduced-motion`, they all fill at once. Each dropdown stays editable, so a visitor can correct a demo car.
9. **One route, three views.** `/quote/car` keeps its route and adds a `vehicle` search value: none for the registration view (screen 08), `manual` (screen 09) and `not-found` (screen 10).
   - **The plate stays out of the URL.** A URL is sent to the server on a refresh and reaches PostHog's pageviews, which would break call 7's promise. The last plate typed goes in the journey object instead, so screen 10 still shows it after a refresh or the back button.
   - The browser's back button moves between the views.
   - A bad `vehicle` value is dropped quietly, as in 5.1.
   - "Back" on screen 09 goes to the registration view.
10. **The picker.**
    - **The cascade:** four `Select`s in screen 09's layout. Make lists every make with an active row, A to Z. Model depends on make, year on model (newest first), and variant on year.
    - **Clearing:** changing a parent clears everything after it, under the line "Changing an earlier answer clears the choices that depend on it."
    - **The car card:** "{make} {model} {variant}" and "{year} · {fuel} · {doors} doors", as drawn.
    - **"Confirm this car":** stays disabled until a variant is chosen.
    - **"Save and exit":** left out of 5.2; 5.6 adds it once quotes can be saved.
11. **"My car isn't listed" and "Contact us about this car"** both open the same panel with decision 5's message. Its link is `mailto:hello@kerb.opsedsolutions.com?subject=Please add my car to Kerb`, with no plate or other detail filled in.
12. **After "Confirm this car":**
    - **The journey object:** gains `vehicle`, a snapshot of the catalogue row (id, make, model, year, variant, fuel, doors) plus the demo plate if one was used. It also keeps `lastPlate`, the last plate typed, for screen 10 (call 9). That matches how a quote's `vehicles` row keeps its own copy (4.8 call 8).
    - **The step:** shows "Your car: Volkswagen Golf 1.0 TSI Life 5dr, 2021. Change", and the slot reads "Driver details arrive in 5.3".
    - **A refresh:** keeps the confirmed car.
    - **A stored car that's no longer in the catalogue** (`is_active = false` after a deploy): it's cleared quietly, and the visitor picks again.
13. **The catalogue API.**
    - **Route:** `GET /api/catalogue` returns the picker's data from `getCatalogue()`: id, make, model, year, variant, fuel, doors and transmission. That's about 1,550 rows, roughly 20 KB gzipped, in one request, so every dropdown change after it is instant.
    - **Cache:** `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400`. The catalogue only changes in a deploy, and a Vercel deploy starts with an empty CDN cache.
    - **Not `publicCacheHeaders()`:** that's the landing's five-minute setting, and this one is deliberately long (engineering.md §5).
14. **TanStack Query arrives here** (5.1, call 12). `@tanstack/react-query` is a new dependency, with one `QueryClient` per request on the server and per tab in the browser. The catalogue query has `staleTime: Infinity`, since it can't change without a deploy, and later data types set their own `staleTime`. The registration view renders without waiting for the catalogue, and "Find my car" waits for it if it hasn't arrived.
15. **The postcode check.**
    - **When:** `/quote/car` checks its postcode before the step shows, through a `checkPostcode` server function. It works the same on a server render and a browser navigation.
    - **The three results:**
      - **Found:** the step shows.
      - **Not found:** redirect to `/quote?type=car&postcode=…`, keeping the postcode in the field with "We couldn't find that postcode. Check it and try again."
      - **postcodes.io down or slow** (2-second timeout): the step shows. A demo shouldn't stop because a free service is down.
    - **The cache, `postcode_areas`:**
      - **Columns:** `postcode` (normalised, primary key), `outcode`, `admin_district`, `region`, `country` and `looked_up_at`.
      - **What's stored:** only found postcodes, so a postcode added later is never stuck as "not found".
      - **The data contract:** not copied to the lakehouse. Phase 9 has the district on `quotes` already.
      - **The app role:** `kerb_app` gets `SELECT` and `INSERT` only, and `db:check-app-role` checks it.
    - **The limit:** 60 postcodes.io calls per IP per hour with the 4.5c `limit()`. A postcode already in `postcode_areas` doesn't count.
    - **When the limit fails:** the check is skipped and the step shows. That covers both `limit()` refusing and its database query failing. The limit protects postcodes.io, and a broken check never blocks a quote.
    - **When the cache fails:** postcodes.io is still asked, because the cache only saves a lookup. A PR preview runs before its migration, so `postcode_areas` can be missing there (build ruling, 9 Nov 2026).
    - **Checked once per postcode:** the route's loader depends on `postcode` only, so moving between the three views or pressing back doesn't check again.
    - **Why it isn't a cached public API:** the phase and engineering.md §5 say "postcode APIs: long public cache". A full postcode in a public URL would sit in CDN logs, so the `postcode_areas` table is the cache instead. engineering.md §5 is updated to say so.
    - **The error on `/quote`:** the redirect adds `error=postcode`, which `startSearch` reads. Someone could write a link that shows the error, but that's harmless, and a bad flag value is dropped like any other.
    - **Testing it:** the integration tests pass in a fake `fetch`. E2E runs against a deployed preview, so it uses the real postcodes.io with `ZZ1 1ZZ`, which is the right format but doesn't exist. No new setting is needed.
    - **Home:** 5.7 uses the same check.
16. **The car step needs JavaScript.** The picker, the demo-plate fill and the journey object all run in the browser, and the journey object lives in `sessionStorage` anyway. Without JavaScript, `/quote/car` shows the Stepper and "The car step needs JavaScript turned on." The 5.1 start form still works without it.

## In scope

- **Routes:**
  - `src/routes/_site/quote.car.tsx`: the `vehicle` and `reg` search values, and the postcode check;
  - `src/routes/api/catalogue.ts`: the catalogue API.
- **Feature code** in `src/features/quote/`:
  - `VehicleStep`, `PlateLookup` (screen 08, with the demo-plate buttons), `VehiclePicker` (screen 09, with the car card), `VehicleNotFound` (screen 10) and `CarNotListed` (the panel);
  - `demo-plates.ts` and plate normalising;
  - the catalogue query;
  - `journey-store.ts`, which gains `vehicle`.
- **Server:**
  - `checkPostcode` (server function), `src/server/quote/postcode.ts` (postcodes.io, the cache and the limit), and a data-layer read and write for `postcode_areas`;
  - the `postcode_areas` table and its migration, data-contract entry and grants.
- **App:** `@tanstack/react-query` and the `QueryClient` in the router context.
- **Start page:** the "couldn't find that postcode" error on `/quote` (`error=postcode` in `startSearch`).- **Docs:** `figma.md` (screen 08's example plate is a placeholder only); engineering.md §5 (the catalogue's cache) and its external-calls row; `phase.md` and `build-plan.md` when done.

## Out of scope

- Driving habits and drivers (5.3), pricing (5.4), saving a quote and "Save and exit" (5.6), home (5.7).
- A real plate lookup, through the DVLA or a data company (decision 3).
- "Use my car from last time" (decision 2).
- Writing a `vehicles` row: that happens when the quote is saved (5.6).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | Plate normalising (case, spaces); every demo plate's last three letters include an I or a Q, and its age identifier matches its year; the journey object round-trips with a `vehicle` and still reads a 5.1 object without one; the `vehicle` search value drops bad values | yes |
| Unit | Every demo plate names exactly one active row in `expandCatalogue()`'s output | yes |
| Component | In real Chromium: tapping a demo plate fills the box without searching; "Find my car" with a demo plate fills make → model → year → variant and shows the card; with reduced motion it fills at once; an unknown plate shows screen 10 with the plate kept; an empty box shows "Enter your registration."; changing the make clears model, year and variant; "Confirm this car" is disabled until a variant is chosen; "My car isn't listed" shows the message and the `mailto` link | yes |
| Integration | `GET /api/catalogue` sends the long public `Cache-Control` and only active rows; `checkPostcode` looks a postcode up once (postcodes.io mocked) and then reads `postcode_areas`; an unknown postcode returns not found and stores nothing; a timeout or 500 from postcodes.io lets the step show; the 61st postcodes.io call in an hour skips the check, and a cached postcode doesn't count; a failing rate-limit query skips the check; `kerb_app` can't update or delete `postcode_areas` | yes |
| E2E | Demo plate → filled picker → confirm → a refresh keeps the car; unknown plate → not found → choose manually → pick → confirm; a made-up postcode (`/quote/car?postcode=ZZ1 1ZZ`, against the real postcodes.io) lands on `/quote` with the error; axe on all three views at phone and desktop width | yes |
| Manual | On staging at phone width and on a laptop: each demo plate fills the right car; the dropdowns on a phone; the "isn't listed" link opens a mail draft to `hello@` | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The manual check passes on staging, with the results recorded here before the PR is merged.

## Commit message

`feat: the car step, finding a car by demo plate or by make, model, year and variant, a friendly message for a car that isn't listed, and the postcode checked with postcodes.io`

## Sources

- phase.md 5.2 row and testing rows; engineering.md §5 (CDN caching, external calls).
- figma.md "Quote · Phase 5 additions", screens 08, 09 and 10.
- 4.8 (the catalogue, `getCatalogue()`, decision 2's message, call 8), 5.1 (the journey object, call 12 on TanStack Query), 4.5c (`limit()`).
- Damion, 9 Nov 2026: the registration box is open to everyone, the plates are faked, and the demo plates are shown.
