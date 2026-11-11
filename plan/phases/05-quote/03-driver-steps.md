# 5.3 Driver steps

**Status:** done (PR pending; manual check on staging still to record). Plan in [03-driver-steps-plan.md](03-driver-steps-plan.md)
**Phase:** 05-quote

## Goal

The rest of the car journey's "Your details". After confirming a car in 5.2, the visitor tells Kerb about themselves, their licence and how the car is used, their claims, and anyone else who'll drive it. When they press "Get my car quote", the journey object holds everything `priceQuote()` (5.4) needs, and every answer has been checked with Zod.

- **The video shot:** add a 19-year-old named driver on screen 12a and, once 5.4 prices it, watch the price rise; remove them and it drops back.
- **Cheap over complete** (Damion, 11 Nov 2026). Anything the database and the v1 rating tables already take is collected and checked. Anything that would need a new rating version or new tables is left out.
- **Nothing is saved on the server.** As in 5.2, the answers live in the tab's journey object until the sign-in gate in 5.6.

## Decisions

1. **Designs and order** (Damion, 11 Nov 2026). The four screens, in this order, all under Stepper step 1 "Your details":
   1. **About you:** the original journey's "Tell us about you and your car" (`157:10429`, in `Quote & Policy – Web`).
   2. **Licence and driving:** screen 11 (`226:669`).
   3. **Claims:** screen 12 (`226:684`).
   4. **Named drivers:** screen 12a (`235:1638`), drawn by Damion on 11 Nov 2026. It ends with "Get my car quote".

   Tablet and mobile adapt them with the existing mobile journey (phase decision).
2. **Named drivers are part of 5.3** (Damion, 11 Nov 2026). The database (`drivers.is_main`) and rating tables v1 (`named_driver_age`, the young-driver excess) already expect them. No quote screen collected them until now.
3. **No convictions question** (Damion, 11 Nov 2026), on screen 12 or 12a.
   - **Why:**
     - Pricing convictions needs a new car v2 rating version, because v1 can't be edited once it's in the database (4.8 call 9).
     - Storing them needs new tables.
     - Collecting them without using them is the bigger problem: motoring convictions are criminal offence data under UK GDPR Article 10.
   - **Later:** a car v2 rating version could bring them back, with a factor and somewhere to store them.
   - **Figma:** Damion removes the convictions sections from screens 12 and 12a.
4. **Claims are counted, not stored in detail** (Damion, 11 Nov 2026). The main driver's incidents go in as drawn on screen 12. Their number becomes `drivers.past_claims`, which 5.4 already prices and refers at 3 or more (4.8 call 17). The details (date, type, fault, cost) stay in the tab and aren't saved in 5.6.

## Calls I've made (check these)

5. **One route, more views.** `/quote/car` keeps its route, as 5.2 did (call 9).
   - **New search value:** `step`, with the values `about`, `driving`, `claims`, `drivers` and `quote`. No value means the car step.
   - **Can't skip ahead:** a link to a step whose earlier steps aren't complete in the journey object goes to the first step that isn't. A bad value is dropped quietly.
   - **The browser's back button** moves between the steps. "Back" on each screen goes to the previous one, and on About you it goes to the confirmed car.
   - **No personal answers in the URL**, for the same reason as 5.2 call 9: a URL reaches the server on a refresh and reaches PostHog's pageviews.
6. **From the car to About you.** The confirmed-car view from 5.2 ("Your car: … Change") gains a "Continue" button, which replaces the slot line "Driver details arrive in 5.3".
7. **About you** (`157:10429`):
   - **The car card on the left** is the confirmed car, as drawn: make, model and variant; year; fuel; doors.
   - **"Full name" becomes two fields,** first name and last name, because that's how `drivers` and `customers` store it and how 12a draws it.
   - **Fields:** date of birth, employment status and occupation (call 10), and the address.
   - **The address:** "Address line 1", "Address line 2 (optional)" and "Town or city", as `customers` stores it. postcodes.io doesn't return street addresses, and a paid address lookup isn't worth it for a demo. The postcode is the one from `/quote`, shown with a "Change" link back to `/quote?type=car&postcode=…`.
   - **Moves off this screen:**
     - "Where is the car kept overnight?" goes to screen 11, which asks it too.
     - The "Confirm your details" box goes to screen 12, which has its own confirmation.
   - **The button** reads "Continue to your licence".
8. **Licence and driving** (screen 11, as drawn), plus one field:
   - **Licence type:**
     - The choices are "Full UK", "Full EU or EEA" and "Provisional UK".
     - Provisional shows "Kerb can't quote for a provisional licence yet." and the step can't continue, because no v1 rating covers learners.
     - The type isn't stored, since `drivers` has no column for it.
   - **Date full licence obtained:** gives `licence_years` (whole years to today).
   - **Years of no-claims discount:** a choice from 0 to "9 or more" (v1 treats 9+ the same) that gives `no_claims_years`.
   - **Annual mileage:** whole miles.
   - **Current mileage:** a new field, "Current mileage (as shown on the dashboard)". `vehicles.current_mileage` is required and nothing else asks for it.
   - **Use of the car:**
     - "Social, domestic and pleasure" is stored as `social`.
     - "Social, domestic and commuting" is stored as `commuting`.
     - "Business use" is stored as `business`.
     - The help text is as drawn.
   - **Where is the car kept overnight?:** "Garage", "Driveway" or "On the street" (`garage`, `driveway`, `street`).
9. **Claims** (screen 12, without the convictions card):
   - **The question:** "Any accidents, claims or losses in the last 5 years?", answered Yes or No.
   - **Each incident:** date, type, responsibility and total claim cost.
     - **Type:** collision, theft, fire, vandalism, windscreen or other.
     - **Responsibility:** at fault, not at fault, or fault not yet decided.
     - **Total claim cost:** in whole pounds, and £0 is allowed.
   - **"Add another incident":** up to 10 incidents. Each incident after the first has a "Remove" link.
   - **"I confirm my driving history is complete and accurate.":** must be ticked to continue.
   - **The button** reads "Continue to named drivers".
10. **Employment status picks the occupation** (on About you and 12a).
    - **The 4.8 list already holds some statuses as occupations,** so this follows from it. Each choice works as follows:

      | Status | What happens |
      |---|---|
      | Employed | Shows the "Occupation" dropdown with the 4.8 jobs |
      | Self-employed | Shows the same dropdown, plus "Self-employed (other)" |
      | Retired | Stores the `retired` key; no second field |
      | Unemployed | Stores the `unemployed` key; no second field |
      | Student | Stores the `student` key; no second field |
      | Looking after the home | Stores the `homemaker` key; no second field |

    - **What's kept:**
      - **The tab** keeps the status next to the occupation key. An employed plumber and a self-employed plumber both store `plumber`, so the key alone can't put the status back after Back, a refresh or "Edit".
      - **5.6 saves only the key.**
    - **The dropdown:**
      - **Its order:** jobs A to Z by label.
      - **What it hides:** the status keys (`retired`, `unemployed`, `student`, `homemaker`), and `self_employed` unless the status is Self-employed.
      - **Where the split lives:** a fixed list in the browser. A unit test checks each fixed key exists in the active car version.
      - **Its control:** a select with type-to-find rather than 12a's free-text box, because only keys from the list can be rated.
11. **The occupation list comes from the active car rating version.**
    - **How:** `GET /api/occupations` returns `{ key, label }` pairs from the active car version's `occupation` lookups, as the phase row asks.
    - **The reader:** a new data-layer reader, `getActiveOccupations()`, memoised in module scope like `getCatalogue()`. Nothing reads the active version's lookups yet; 4.8 only writes them.
    - **No bands:** the band is pricing, so it never reaches the browser.
    - **Caching:**
      - The route sends the catalogue's long public `Cache-Control` (5.2 call 13), because the active version only changes with a deploy.
      - The query has `staleTime: Infinity` (5.2 call 14).
    - **On save:** 5.6 re-checks the stored key against the active version, as it does for the car.
12. **Named drivers** (screen 12a, without the convictions question):
    - **"Would you like to add a named driver?":**
      - Yes shows "Named driver 1".
      - No hides the driver forms and keeps nothing from them.
      - Adding then removing every driver sets the answer back to No.
    - **Each driver:**
      - **The fields:** first and last name, date of birth, relationship to you, employment status and occupation (call 10), licence type and the date their full licence was obtained.
      - **Claims:** "Any accidents, claims or losses in the last 5 years?". Yes asks "How many?", with a choice from 1 to "5 or more", stored as 1 to 5.
    - **Relationship to you:**
      - **The choices:** "Spouse or civil partner", "Partner", "Parent", "Son or daughter", "Brother or sister", "Other relative" or "Friend or colleague".
      - **Where it's kept:** in the tab only. `drivers` has no column for it, and v1 doesn't rate it.
    - **No-claims years** are stored as 0 for a named driver. In the UK a named driver doesn't earn a no-claims discount on someone else's policy, and the column is required.
    - **The licence:** the same rules as the main driver. A provisional licence can't be added: "A named driver needs a full licence."
    - **"Add another driver"** allows up to 4 named drivers, the usual UK limit.
    - **"Remove driver"** takes the driver out straight away and moves focus to the next driver's heading, or to the Yes/No question if none are left. Nothing asks "Are you sure?", because nothing is saved yet.
    - **The card heading** follows the first name: "Jamie's licence and driving history", or "Their licence and driving history" until a first name is typed.
13. **Validation (Zod), in `src/features/quote/schemas/`.** These are the phase's coverage-threshold folder and the 5.3 unit-test row.
    - **Age:**
      - Every driver must be 17 or over on the day the step is completed. Kerb doesn't ask for a cover start date until 5.5, which re-checks it.
      - Every driver must be 100 or under. Anything older is treated as a mistyped year.
    - **Dates:**
      - **Licence date:** not before the driver's 17th birthday, and not in the future.
      - **Incident dates:** within the last 5 years, and not in the future.
    - **No-claims years:** no more than whole years since the licence date. Without it, someone licensed last year could pick 9.
    - **Numbers:**
      - **Annual mileage:** 1 to 100,000.
      - **Current mileage:** 0 to 999,999.
      - **Claim cost:** £0 to £1,000,000.
    - **Text:** names are 1–50 characters. Address line 1 and town are 1–100 characters, and address line 2 is up to 100 characters.
    - **The error copy** is plain and never repeats the typed value (4.5c contract). "Enter a date of birth.", "You must be 17 or over to get a quote.", "The licence date can't be before your 17th birthday.", "Your no-claims years can't be more than the years you've held a licence."
    - **Shared with the server:** 5.6 parses the same schemas when it saves.
14. **Dates use three boxes** (day, month, year), the GOV.UK pattern, instead of the single text box drawn. They're easy to type on a phone and to label for a screen reader, and they have no picker to fight. Figma keeps its look; only the control changes.
15. **What the journey object gains** (version stays 1, and every new field is optional, so a 5.2 object still reads):
    - **`mainDriver`:** name, date of birth, occupation key, address lines and town, licence type, licence date and no-claims years.
    - **`usage`:** annual mileage, current mileage, use and overnight location.
    - **`claims`:** the Yes/No answer, the incidents and the confirmation.
    - **`namedDrivers`:** the Yes/No answer and up to 4 drivers.

    Each step writes its part when "Continue" is pressed. Unfinished typing on a screen isn't kept.

    **Each part is read back on its own.** A part that no longer parses is dropped alone, and the car and the other parts stay. Today the whole journey is thrown away when any part fails.

    **Changing the car** keeps the driver answers. Only screen copy like "the Volkswagen Golf" follows the new car.
16. **Answers that turn invalid later.** Some rules span screens: the licence date is checked against the date of birth from About you. Others depend on today: the 5-year incident window, and being 17 on the day.
    - **The check:** a step counts as complete only if its schema passes against the other stored parts and today's date. The "can't skip ahead" rule (call 5) and "Get my car quote" both run this check.
    - **After an edit:** "Continue" on a step re-checks the steps after it. If one now fails, the visitor goes to the first one that fails, with its errors shown. Otherwise they go to the next step.
    - **From the summary:** "Edit" on the holding summary works the same way, except that when every later step still passes, "Continue" returns to the summary.
17. **After "Get my car quote".**
    - **Where it goes:** to `step=quote`, and the Stepper moves to "Your quote".
    - **What it shows until 5.4:** "Your price arrives in 5.4" and a short summary of the answers, with an "Edit" link to each step. 5.4 replaces that slot with the price.
18. **The quote steps need JavaScript,** as the car step does (5.2 call 16).
19. **No new analytics.** No funnel event per step, and no answer leaves the tab. PostHog's autocapture already masks input values, and the component test checks that no answer appears in the URL.
20. **"Save and exit"** is left out, as in 5.2: 5.6 adds it once quotes can be saved.

## In scope

- **Route:** `src/routes/_site/quote.car.tsx` gains the `step` search value and the "can't skip ahead" rule. `src/features/quote/search.ts` gains `step`, with bad values dropped.
- **Feature code** in `src/features/quote/`:
  - **The screens:** `AboutYouStep`, `LicenceStep`, `ClaimsStep`, `NamedDriversStep` and the `QuoteHolding` slot.
  - **Shared pieces:** `OccupationField` (status → occupation), `DateField` (three boxes) and `DriverHistory` (incidents).
  - **The data:** the occupations query; `journey-store.ts` gains the four parts.
- **Schemas:** `src/features/quote/schemas/` for the about-you, licence-and-usage, claims and named-driver steps, with their unit tests.
- **Server:** `src/routes/api/occupations.ts` and the `getActiveOccupations()` reader, from the active car rating version's `occupation` lookups.
- **Docs:**
  - **`figma.md`:** screen 12a's row; the "Tell us about you" frame as the About you screen; screens 11, 12 and 12a lose convictions.
  - **`phase.md` and `build-plan.md`:** marked done when the slice is.

## Out of scope

- **Pricing and eligibility,** including named drivers and the young-driver excess (5.4).
- **Saving answers to `drivers` and `vehicles`,** and "Save and exit" (5.6).
- **Convictions** (decision 3).
- **A real address lookup,** and storing incident details or a named driver's relationship.
- **Changing the drivers on a live policy** (6.3).

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | Step schemas: driver aged 17 passes and 16 fails, on the day before and on the birthday; over 100 fails; licence date before the 17th birthday or in the future fails; no-claims years over the years licensed fails; incident older than 5 years or in the future fails; mileage and claim-cost bounds; claims shape (Yes needs at least one incident, No needs none; at most 10); named drivers (at most 4; provisional refused; claims count 1–5); provisional main licence refused; error messages never contain the typed value. (The phase row's "UK postcode format" is already covered by 5.1's `postcodeSchema` tests, since 5.3 asks for no new postcode.) | yes |
| Unit | Status → occupation: each non-working status maps to its 4.8 key; every key in the browser's fixed status list exists in the active car version; a stored part that no longer parses is dropped alone and the rest of the journey stays; the journey object round-trips with all four parts and still reads a 5.2 object; the `step` search value drops bad values | yes |
| Integration | `GET /api/occupations` sends the long public `Cache-Control`, returns only the active car version's occupations as `{ key, label }`, and no band | yes |
| Component | In real Chromium: car confirmed → Continue → About you; a direct link to `step=claims` with no driver goes to About you; Retired hides the occupation dropdown and Employed shows it; a provisional licence blocks Continue with the message; Yes on claims shows an incident, "Add another incident" adds one and "Remove" takes it out; the confirmation box is required; Yes on named drivers shows driver 1, up to 4 can be added, "Remove driver" moves focus; a refresh on any step keeps the saved answers; changing the date of birth so the licence date fails sends Continue to the licence step with its error; "Edit" from the summary returns to it; going back keeps them; no answer appears in the URL | yes |
| E2E | Demo plate → confirm → About you → licence → claims (one incident) → one named driver aged 19 → "Get my car quote" lands on the holding view with the summary; axe on each step at phone and desktop width | yes |
| Manual | On staging at phone width and on a laptop: the four screens match their frames (minus convictions); the date boxes on a phone keyboard; the occupation dropdown's type-to-find | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR. Locally (11 Nov 2026): `vp check` clean, `vp test` 123 files and 1,631 tests, `vp build`; the driver-steps E2E, 5.2's vehicle E2E and axe on every quote page at 390 and 1440 px, 25/25 on a local preview.
- [ ] The manual check passes, with the results recorded here.

## Commit message

`feat: the driver steps, about you, licence and driving, claims and named drivers, each checked with Zod, with the occupation list from the active car rating version`

## Sources

- **Plan:** phase.md, the 5.3 row and its testing row.
- **Figma:** the `Quote & Policy – Web` step "Tell us about you and your car" (`157:10429`); "Quote · Phase 5 additions" screens 11 (`226:669`) and 12 (`226:684`); screen 12a (`235:1638`).
- **Earlier slices:**
  - 4.2: the `drivers`, `vehicles` and `customers` columns.
  - 4.8: the occupation list, `named_driver_age`, the young-driver excess, call 9 (versions are immutable) and call 17 (eligibility).
  - 4.5c: the validation-error contract.
  - 5.2: calls 9, 12, 14 and 16.
- **Damion, 11 Nov 2026:** named drivers in 5.3; convictions dropped; claims counted; cheap over complete.
