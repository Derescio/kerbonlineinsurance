# 5.3 Driver steps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after the confirmed car, `/quote/car` walks through About you → Licence and driving → Claims → Named drivers → a holding "Your quote" view. Every answer is checked with Zod and kept in the tab's journey object, and the occupation list comes from the active car rating version.

**Architecture:** There are four layers.
1. **Pure rules** in `src/features/quote/`:
   - date helpers and the status → occupation mapping;
   - one Zod schema per step in `schemas/`;
   - the journey object's four new parts, read back part by part;
   - `stepState()`, which says which steps are complete against today's date;
   - the `step` search value.
2. **Server:** `GET /api/occupations` (`{ key, label }` only), read through `getRatingTables()` for the active car version.
3. **Components:**
   - `DateField` and `OccupationField` are shared;
   - one component per screen;
   - `DriverSteps` runs the order, the "re-check later steps" rule and "Edit" from the summary.
4. **Route:** `quote.car.tsx` reads `step` and hands it to `DriverSteps` once a car is confirmed. `JourneyShell` takes the Stepper's current step.

**Tech Stack:** TanStack Start / Router 1.170, `@tanstack/react-query`, React 19, Zod 4, Drizzle on `pg`, Vitest `unit` / `integration` / `component` projects, Playwright with axe.

**Spec:** [03-driver-steps.md](03-driver-steps.md). Read decisions 1–4 and calls 5–20 before starting.

## Global Constraints

- **Route:** `/quote/car`. The search keys are `postcode`, `vehicle` (5.2) and `step` (`"about"` | `"driving"` | `"claims"` | `"drivers"` | `"quote"`; absent means the car step). A bad `step` value is dropped. No answer is ever in the URL.
- **Order:** car → `about` → `driving` → `claims` → `drivers` → `quote`. The Stepper shows step 0 ("Your details") for the car through `drivers`, and step 1 ("Your quote") for `quote`.
- **Today:** "today" is the London date as `YYYY-MM-DD`, from `todayIso()`. Ages and whole years are calendar comparisons on these strings, never millisecond maths. A 29 February birthday counts as 28 February in other years.
- **Limits:**
  - **Age:** 17 to 100 inclusive.
  - **Annual mileage:** 1 to 100,000.
  - **Current mileage:** 0 to 999,999.
  - **Claim cost:** £0 to £1,000,000, in whole pounds.
  - **Lists:** incidents 1 to 10 when the answer is Yes; named drivers 1 to 4 when Yes; a named driver's claims count 1 to 5.
  - **No-claims years:** 0 to 9, where 9 means "9 or more".
  - **Text:** names 1–50 characters; address line 1 and town 1–100; address line 2 up to 100. All are trimmed.
- **Stored values:**
  - **`usage`:** `social` | `commuting` | `business`.
  - **`overnight`:** `garage` | `driveway` | `street`.
  - **`licenceType`:** `full_uk` | `full_eu` | `provisional`.
  - **`incident.type`:** `collision` | `theft` | `fire` | `vandalism` | `windscreen` | `other`.
  - **`incident.fault`:** `at_fault` | `not_at_fault` | `undecided`.
  - **`relationship`:** `spouse` | `partner` | `parent` | `child` | `sibling` | `other_relative` | `friend`.
  - **`status`:** `employed` | `self_employed` | `retired` | `unemployed` | `student` | `homemaker`.
- **Status → occupation:**
  - `retired` → `retired`, `unemployed` → `unemployed`, `student` → `student`, `homemaker` → `homemaker`.
  - `employed` and `self_employed` take a chosen job key. Only `self_employed` may choose `self_employed`.
  - The Employed list hides `retired`, `unemployed`, `student`, `homemaker` and `self_employed`.
- **Copy:** UI text uses the curly apostrophe (’), written `&rsquo;` in JSX, as 5.2 does.
  - **About you:**
    - **Headings:** eyebrow `Car · Your details · About you`; title `Tell us about you`; intro `We’ll use this information to build your quote for the {year} {make} {model}.`
    - **Labels:** `First name`, `Last name`, `Date of birth`, `Employment status`, `Occupation`, `Address line 1`, `Address line 2`, `Town or city`.
    - **The postcode:** `Home postcode: {postcode}.`, with a `Change` link.
    - **The button:** `Continue to your licence`.
  - **Licence and driving (screen 11):**
    - **Headings:** eyebrow `Car · Your details · Driving`; title `Your licence and driving`; intro `A few more details about {firstName} {lastName} and how the {make} {model} is used.`
    - **Cards:** `Your driving licence` and `How you use your car`.
    - **Labels:** `Licence type`, `Date full licence obtained` (hint `Use the date you passed your test.`), `Years of no-claims discount` (hint `Use the number on your latest renewal notice. We may ask for proof.`), `Annual mileage` (suffix `miles`, hint `Estimated miles over the next 12 months.`), `Current mileage` (suffix `miles`, hint `As shown on the dashboard.`), `Use of the car`, `Where is the car kept overnight?`.
    - **Usage note:** `Commuting includes travelling to a regular place of work. Choose business use if you drive between work locations. Delivery or hire-and-reward use needs different cover.`
    - **Licence options:** `Full UK`, `Full EU or EEA`, `Provisional UK`.
    - **Use options:** `Social, domestic and pleasure`, `Social, domestic and commuting`, `Business use`.
    - **Overnight options:** `Garage`, `Driveway`, `On the street`.
    - **No-claims options:** `0 years`, `1 year`, `2 years` … `8 years`, `9 or more years`.
    - **The button:** `Continue to driving history`.
  - **Claims (screen 12):**
    - **Headings:** eyebrow `Car · Your details · History`; title `Claims`; intro `Tell us about the main driver’s history. Add each incident separately, including incidents at a previous insurer.`
    - **The question:** legend `Any accidents, claims or losses in the last 5 years?`, hint `Include incidents even if you didn’t claim, and whether or not you were at fault.`, options `Yes` / `No`.
    - **Incident labels:** `Date of incident`, `Type of incident`, `Responsibility`, `Total claim cost` (prefix `£`).
    - **Type options:** `Collision`, `Theft`, `Fire`, `Vandalism`, `Windscreen`, `Other`.
    - **Responsibility options:** `At fault`, `Not at fault`, `Fault not yet decided`.
    - **Buttons:** `Add another incident`, and `Remove` with `incident {n}` hidden for screen readers.
    - **Confirmation:** `I confirm my driving history is complete and accurate.`
    - **The button:** `Continue to named drivers`.
  - **Named drivers (screen 12a):**
    - **Headings:** eyebrow `Car · Your details · Named drivers`; title `Who else will drive your car?`; intro `Add anyone else who needs to drive the {make} {model}. You’ll remain the main driver.`
    - **The question:** legend `Would you like to add a named driver?`, hint `Only people listed on your policy will be covered to drive your car.`
    - **Each driver's card:**
      - **Headings:** `Named driver {n}`, with `Remove driver`.
      - **Labels:** `First name`, `Last name`, `Date of birth`, `Relationship to you`, `Employment status`, `Occupation`.
      - **The name hint:** `Use their name as it appears on their driving licence.`
    - **Each driver's history card:**
      - **Heading:** `{firstName}’s licence and driving history`, or `Their licence and driving history` while there's no first name.
      - **Labels:** `Licence type`, `Date full licence obtained`.
      - **The claims question:** `Any accidents, claims or losses in the last 5 years?`, with the hint `Include incidents even if they didn’t claim, or weren’t at fault.`
      - **The follow-up:** `How many?`, with the options `1`, `2`, `3`, `4`, `5 or more`.
    - **Relationship options:** `Spouse or civil partner`, `Partner`, `Parent`, `Son or daughter`, `Brother or sister`, `Other relative`, `Friend or colleague`.
    - **Buttons:** `Add another driver` (hidden at 4) and `Get my car quote`.
  - **Status options** (both screens): `Employed`, `Self-employed`, `Retired`, `Unemployed`, `Student`, `Looking after the home`.
  - **Holding view:**
    - **Headings:** eyebrow `Car · Your quote`; title `Your quote`; the line `Your price arrives in 5.4`.
    - **The summary:** four rows, `About you`, `Licence and driving`, `Claims` and `Named drivers`, each with an `Edit` link that has the row name hidden for screen readers.
  - **Every screen** has a `Back` button.
  - **Car step:** the confirmed view's slot line is replaced by a `Continue` button.
- **Error copy:** never repeats the typed value (4.5c).
  - **Required fields:**
    - **A text box:** `Enter your first name.`, `Enter your last name.`, `Enter the first line of your address.`, `Enter your town or city.`
    - **A choice:** `Choose your employment status.`, `Choose your occupation.`, `Choose a licence type.`, `Choose how many years of no-claims discount you have.`, `Choose how the car is used.`, `Choose where the car is kept overnight.`, `Choose the type of incident.`, `Choose who was at fault.`, `Choose their relationship to you.`, `Choose how many.`
    - **A Yes/No question:** `Answer yes or no.`
    - **The confirmation box:** `Confirm your driving history to continue.`
  - **Dates:** `Enter a date of birth.` (and `Enter the date your full licence was obtained.`, `Enter the date of the incident.`) for empty or impossible dates.
  - **Age:** `You must be 17 or over to get a quote.`; `Check the year of birth.` (over 100).
  - **Named drivers:** `Named drivers must be 17 or over.`; `A named driver needs a full licence.`
  - **The licence:** `The licence date can’t be before your 17th birthday.`; `The licence date can’t be in the future.`; `Kerb can’t quote for a provisional licence yet.`
  - **No-claims years:** `Your no-claims years can’t be more than the years you’ve held a licence.`
  - **Incident dates:** `The incident must be in the last 5 years.`; `The incident date can’t be in the future.`
  - **Numbers:**
    - **The bounds:** `Enter a mileage up to 100,000.`, `Enter a mileage up to 999,999.` and `Enter a cost up to £1,000,000.`
    - **Empty or not a whole number:** `Enter the annual mileage in whole miles.`, `Enter the current mileage in whole miles.` and `Enter the cost in whole pounds.`
- **Occupations API:** `GET /api/occupations` → `{ occupations: { key: string; label: string }[] }`, sorted by label. It sends 5.2's `CATALOGUE_CACHE_CONTROL`, and a failure sends `503` with `no-store`.
- **Storage:** the journey object stays `version: 1` and gains optional `mainDriver`, `usage`, `claims` and `namedDrivers`. A 5.2 object still reads. A part that fails its schema is dropped alone.
- **Process:**
  - Stage files by name.
  - No `vp build` or component tests while Damion's `vp dev` is running (stale deps cache).
  - Commits end with the Opsed Solutions co-author trailer (memory) and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Calls this plan makes (for Damion to check)

- **P1. About you's title is "Tell us about you".** The car is already confirmed, so "and your car" no longer fits. The car card loses its Mileage row, because mileage is asked on the next screen.
- **P2. A date that doesn't exist is "empty".** 31 February, or a two-digit year, gets the "Enter a …" message rather than its own message.
- **P3. The summary rows are short:**
  - **About you:** `{first} {last}, born {d MMM yyyy}`.
  - **Licence and driving:** `{licence label}, {n} years’ no-claims, {mileage} miles a year`.
  - **Claims:** `{n} incidents` or `None`.
  - **Named drivers:** the names, or `None`.

  5.4 replaces the view.
- **P4. "Back" from About you returns to the confirmed-car view,** which has `Change` and `Continue`.
- **P5. `firstIncompleteStep` runs on every `step` change in the browser.** The answers live in `sessionStorage`, so the redirect can't happen in `beforeLoad` on the server. It uses `navigate({ replace: true })`, so a blocked link doesn't leave a history entry.

## Review Focus

1. **A visitor who lands on `?step=drivers` in a fresh tab** (shared link, bookmark). They're sent to the car step, not shown an empty form. Test in Task 6.
2. **A journey saved yesterday, with an incident from exactly 5 years ago today.** It turns invalid overnight, and the claims step must reopen with its error rather than letting "Get my car quote" through. Test in Task 3 (`stepState` with a later `today`).
3. **The occupation list fails to load** (cold start, database down). The status field still works. Retired and its siblings can continue, Employed shows `We couldn’t load the list of occupations. Try again in a moment.` with a retry, and the CDN doesn't keep the failure. Test in Tasks 4 and 5.
4. **A stored occupation key that the active version no longer lists** (a later v2 drops a job). The field shows empty and asks again, and nothing throws. Test in Task 5.
5. **Removing named driver 2 of 3.** Driver 3 becomes "Named driver 2", its answers stay with it rather than shifting into the removed card's inputs, and focus moves to its heading. Test in Task 5 (React keys are stable ids, not indexes).

---

## File structure

| File | Responsibility |
|---|---|
| `src/features/quote/schemas/dates.ts` (+ test) | `todayIso`, `isoFromParts`, `ageOn`, `wholeYearsBetween`, `addYears` |
| `src/features/quote/occupation.ts` (+ test) | statuses, `STATUS_OCCUPATIONS`, `occupationFor`, `statusFor`, `jobOptions` |
| `src/features/quote/schemas/driver-steps.ts` (+ test) | the four step schemas, option lists and error copy |
| `src/features/quote/journey-store.ts` (+ test) | the four parts, read part by part, `setStepAnswers` |
| `src/features/quote/steps.ts` (+ test) | `DRIVER_STEPS`, `stepState`, `firstIncompleteStep` |
| `src/features/quote/search.ts` (+ test) | `step` |
| `src/server/data/reference.ts`, `src/server/quote/occupations.ts` (+ `.int.test.ts`), `src/routes/api/occupations.ts`, `src/features/quote/occupations-query.ts` | the occupation list |
| `src/features/quote/DateField.tsx`, `OccupationField.tsx` | shared fields |
| `src/features/quote/AboutYouStep.tsx`, `LicenceStep.tsx`, `ClaimsStep.tsx`, `NamedDriversStep.tsx`, `QuoteHolding.tsx`, `DriverSteps.tsx`, `quote.css` | the screens and the flow |
| `src/features/quote/drivers.browser.test.tsx` | component tests |
| `src/features/quote/JourneyShell.tsx`, `VehicleStep.tsx`, `src/routes/_site/quote.car.tsx` | wiring |
| `e2e/drivers.spec.ts`, `e2e/a11y.spec.ts` | E2E |
| `plan/figma.md`, `plan/phases/05-quote/phase.md`, `plan/build-plan.md`, the spec | docs |

---

### Task 1: Dates and occupation statuses

**Files:**
- Create `src/features/quote/schemas/dates.ts`, `dates.test.ts`, `src/features/quote/occupation.ts` and `occupation.test.ts`.
- Modify `src/server/reference/rating/car-v1.test.ts` (or the nearest existing car-v1 test).

**Interfaces (Produces):**
- **`todayIso(now: Date = new Date()): string`:** the London date as `YYYY-MM-DD`, through `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" })`.
- **`isoFromParts(day: string, month: string, year: string): string | null`:** a real calendar date with a four-digit year, else `null` (P2).
- **`ageOn(dateOfBirth: string, today: string): number`:** whole years.
- **`wholeYearsBetween(from: string, to: string): number`:** the same arithmetic, with 0 when `to < from`.
- **`addYears(iso: string, years: number): string`:** 29 Feb becomes 28 Feb.
- **`type EmploymentStatus`:** `"employed" | "self_employed" | "retired" | "unemployed" | "student" | "homemaker"`.
- **`statusOptions: { value: EmploymentStatus; label: string }[]`:** in the Global Constraints order.
- **`STATUS_OCCUPATIONS`:** `{ retired: "retired", unemployed: "unemployed", student: "student", homemaker: "homemaker" } as const`.
- **`HIDDEN_FROM_JOBS`:** the four values above plus `"self_employed"`.
- **`occupationFor(status: EmploymentStatus, job: string | undefined): string | undefined`:** the fixed key for a non-working status; otherwise the job.
- **`jobOptions(all: { key: string; label: string }[], status: "employed" | "self_employed")`:** the list without `HIDDEN_FROM_JOBS`. Self-employed also gets `self_employed`, which goes last.

- [ ] **Step 1: Write the failing tests.**
  - **`dates.test.ts`:**
    - **The London date:** `todayIso(new Date("2026-03-29T00:30:00Z"))` is `"2026-03-29"`, and `todayIso(new Date("2026-06-30T23:30:00Z"))` is `"2026-07-01"` (BST).
    - **Checking the parts:** `isoFromParts("31","2","2000")` is `null`; `("1","1","99")` is `null`; `("5","3","1991")` is `"1991-03-05"`.
    - **Ages:** `ageOn("2009-11-11","2026-11-11")` is 17; `ageOn("2009-11-12","2026-11-11")` is 16; `ageOn("2008-02-29","2025-02-28")` is 17.
    - **Whole years:** `wholeYearsBetween("2020-05-01","2026-04-30")` is 5.
    - **Adding years:** `addYears("2008-02-29", 17)` is `"2025-02-28"`.
  - **`occupation.test.ts`:**
    - **Mapping a status:** `occupationFor("retired", "plumber")` is `"retired"`, and `occupationFor("employed", "plumber")` is `"plumber"`.
    - **The job lists:** `jobOptions` for employed has no `HIDDEN_FROM_JOBS` key; for self-employed it ends with `self_employed`.
  - **The car-v1 test:** every value of `STATUS_OCCUPATIONS`, plus `"self_employed"`, is an `occupation` lookup key in `carV1`.
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project unit src/features/quote src/server/reference/rating` fails on the missing modules.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run the tests and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(quote): London dates, ages and the employment status to occupation mapping`.

### Task 2: The step schemas

**Files:** create `src/features/quote/schemas/driver-steps.ts` and `driver-steps.test.ts`.

**Interfaces:**
- **Consumes:** Task 1.
- **Produces** (every schema is a function of today, so tests pin the date):
  - **About you:** `aboutYouSchema(today: string)` → `AboutYou`:

    ```ts
    {
      firstName: string;
      lastName: string;
      dateOfBirth: string; // ISO
      status: EmploymentStatus;
      occupation: string;
      addressLine1: string;
      addressLine2?: string;
      town: string;
    }
    ```

  - **Licence and driving:** `licenceSchema(today: string, dateOfBirth: string)` → `LicenceAndUsage`:

    ```ts
    {
      licenceType: "full_uk" | "full_eu";
      licenceDate: string;
      noClaimsYears: number;
      annualMileage: number;
      currentMileage: number;
      usage: Usage;
      overnight: Overnight;
    }
    ```

    The step schema refuses `provisional`. The stored type is the two full types.
  - **Claims:** `claimsSchema(today: string)` → `Claims`:

    ```ts
    {
      any: boolean;
      incidents: { id: string; date: string; type: IncidentType; fault: Fault; costPounds: number }[];
      confirmed: true;
    }
    ```

    `any: false` needs `incidents: []`. `any: true` needs 1 to 10 incidents.
  - **Named drivers:** `namedDriversSchema(today: string)` → `NamedDrivers`:

    ```ts
    {
      any: boolean;
      drivers: {
        id: string;
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        relationship: Relationship;
        status: EmploymentStatus;
        occupation: string;
        licenceType: "full_uk" | "full_eu";
        licenceDate: string;
        pastClaims: number; // 0–5
      }[];
    }
    ```

    `any: false` needs `drivers: []`. `any: true` needs 1 to 4 drivers.
  - **The options:** `licenceOptions`, `usageOptions`, `overnightOptions`, `noClaimsOptions`, `incidentTypeOptions`, `faultOptions` and `relationshipOptions`, each `{ value; label }[]` with the Global Constraints copy.
  - **The error copy:** exported as `errors` (the Global Constraints strings).
  - **The occupation rule:** `occupation` must equal `occupationFor(status, occupation)`. A non-working status forces its key, and a working status can't take a hidden key unless self-employed.
  - **Dates in schemas** are ISO strings. The three-box form turns parts into ISO with `isoFromParts` before parsing.

- [ ] **Step 1: Write the failing tests** in `driver-steps.test.ts`. They use `today = "2026-11-11"` and the 4.5c `parseInput` to check field paths and messages.
  - **About you:**
    - **Age:** a date of birth of `2009-11-11` passes. `2009-11-12` gives `dateOfBirth: "You must be 17 or over to get a quote."`, and `1926-11-10` gives `"Check the year of birth."`.
    - **Text:** blank names give the "Enter…" messages, a 51-character name fails, and padding is trimmed.
    - **Status and occupation:** `status: "retired", occupation: "plumber"` fails on `occupation`. `status: "employed", occupation: "student"` fails.
  - **Licence and driving:**
    - **The licence type:** `provisional` gives `licenceType: "Kerb can’t quote for a provisional licence yet."`.
    - **The licence date:** a date the day before the 17th birthday fails with the 17th-birthday message, and the birthday itself passes. A future date fails.
    - **No-claims years:** 6 with a licence held 5 whole years fails with the no-claims message; 5 passes.
    - **Mileage:** annual 0 and 100,001 fail, and 100,000 passes. Current 0 passes.
  - **Claims:**
    - **The window:** an incident on `2021-11-11` passes and `2021-11-10` fails ("in the last 5 years"). `2026-11-12` fails ("can’t be in the future").
    - **The list:** `any: true` with no incidents fails; 11 incidents fail. `any: false` with an incident fails.
    - **The rest:** a cost of 1,000,001 fails. `confirmed: false` gives `Confirm your driving history to continue.`.
  - **Named drivers:**
    - **The list:** 5 drivers fail.
    - **One driver:** aged 16 gives `drivers.0.dateOfBirth: "Named drivers must be 17 or over."`; a `provisional` licence gives `"A named driver needs a full licence."`; `pastClaims` 6 fails.
  - **No echo:** for each schema, no message contains the input value (fuzz with `"Zq9xValue"` in each text field).
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project unit src/features/quote/schemas` fails.
- [ ] **Step 3: Implement** the schemas, with `superRefine` for the cross-field rules. Each message is set explicitly, so Zod's built-in text never shows (4.5c).
- [ ] **Step 4: Run the tests and see them pass**, including the coverage threshold for `src/features/quote/schemas`.
- [ ] **Step 5: Commit** with `feat(quote): Zod schemas for about you, licence and driving, claims and named drivers`.

### Task 3: The journey parts, step state and `step` search value

**Files:**
- Modify `src/features/quote/journey-store.ts`, `journey-store.test.ts`, `search.ts` and `search.test.ts`.
- Create `src/features/quote/steps.ts` and `steps.test.ts`.

**Interfaces:**
- **Consumes:** Task 2's types and schemas.
- **Produces:**
  - **The journey object:** `Journey` gains `mainDriver?: AboutYou & { licenceType; licenceDate; noClaimsYears }`, `usage?: { annualMileage; currentMileage; usage; overnight }`, `claims?: Claims` and `namedDrivers?: NamedDrivers`.
    - **The stored shapes** check types and enums only (loose). The date rules are `stepState`'s job.
    - **Splitting the licence step:** About you writes `mainDriver` without the licence fields, and Licence writes both the licence fields and `usage`.
  - **Reading the parts:** `readJourney` parses the base fields first; a failure there still means `null`. Then it `safeParse`s each optional part (`vehicle`, `mainDriver`, `usage`, `claims`, `namedDrivers`) and drops only the parts that fail.
  - **Writing a step:** `setStepAnswers(step: "about" | "driving" | "claims" | "drivers", answers, storage?)` merges that step's part(s) in. It does nothing without a car journey.
  - **The step list:** `DRIVER_STEPS = ["about", "driving", "claims", "drivers"] as const`, and `type QuoteStep = (typeof DRIVER_STEPS)[number] | "quote"`.
  - **Checking the steps:** `stepState(journey: Journey, today: string): Record<(typeof DRIVER_STEPS)[number], boolean>`. A step is `true` when its stored answers pass its step schema against `today` and the stored date of birth.
  - **Where to go:** `firstIncompleteStep(journey: Journey | null, today: string): "car" | (typeof DRIVER_STEPS)[number] | null`. No vehicle gives `"car"`; all complete gives `null`.
  - **The search value:** `CarSearch` gains `step?: QuoteStep`, and `carSearch` returns it, or `undefined` for a bad value.

- [ ] **Step 1: Write the failing tests.**
  - **`journey-store.test.ts`:**
    - **Round-trip:** all four parts write and read back.
    - **Older journeys:** a 5.2 object (vehicle only) still reads.
    - **Bad parts:** an object whose `claims.incidents[0].type` is `"meteor"` reads with `claims` dropped and `vehicle` and `mainDriver` kept.
    - **No car journey:** `setStepAnswers` does nothing.
  - **`steps.test.ts`:**
    - **The car first:** no vehicle → `"car"`.
    - **In order:** vehicle only → `"about"`; through `claims` → `"drivers"`; all complete → `null`.
    - **The date rules:**
      - A journey complete on `2026-11-11` with an incident on `2021-11-11` gives `claims: false` on `today = "2026-11-12"` (Review Focus 2).
      - Moving `mainDriver.dateOfBirth` later, so the licence date falls before the 17th birthday, makes `driving` false.
  - **`search.test.ts`:** `step: "claims"` is kept; `"payment"`, `1` and a missing value give `undefined`; `vehicle` is unchanged.
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project unit src/features/quote` fails.
- [ ] **Step 3: Implement** the changes.
- [ ] **Step 4: Run the tests and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(quote): the journey keeps each driver step's answers, read back part by part, and knows which steps are complete`.

### Task 4: The occupation list API

**Files:**
- Modify `src/server/data/reference.ts`.
- Create `src/server/quote/occupations.ts`, `occupations.int.test.ts`, `src/routes/api/occupations.ts` and `src/features/quote/occupations-query.ts`.

**Interfaces:**
- **Consumes:** `getActiveRatingVersion`, `getRatingTables` and `CATALOGUE_CACHE_CONTROL`.
- **Produces:**
  - **The reader:** `getActiveOccupations(db: Db = getDb()): Promise<readonly { key: string; label: string }[]>`. It finds the active car version, then reads `lookups` where `lookup === "occupation"`, mapped to `{ key, label }` and sorted by label with `localeCompare("en-GB")`. It throws when there's no active car version.
  - **The response:** `occupationsResponse(load = () => getActiveOccupations()): Promise<Response>`. It returns `{ occupations }` with `CATALOGUE_CACHE_CONTROL`, or `503` with `no-store`.
  - **The route:** `GET /api/occupations`.
  - **The query:** `occupationsQuery = queryOptions({ queryKey: ["occupations"], queryFn, staleTime: Infinity, gcTime: Infinity })`. Its `queryFn` fetches `/api/occupations` and throws on a response that isn't OK.

- [ ] **Step 1: Write the failing integration tests** in `occupations.int.test.ts`. Load reference data the way the catalogue's integration test does, and call `clearReferenceCaches()` before each test.
  - **The response:**
    - It has `CATALOGUE_CACHE_CONTROL`.
    - The body's keys equal car-v1's occupation keys.
    - Every item has exactly the keys `key` and `label`, so no `band` or `group`.
    - The items are sorted by label.
  - **A load that throws** gives `503` and `Cache-Control: no-store`.
  - **No active car version** (set it to `retired` with the owner db) gives `503`.
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project integration src/server/quote/occupations.int.test.ts` fails.
- [ ] **Step 3: Implement** the reader, response, route and query.
- [ ] **Step 4: Run the tests and see them pass.** The same command passes.
- [ ] **Step 5: Commit** with `feat(quote): the occupation list from the active car rating version, cached on the CDN`.

### Task 5: The fields and the four screens

**Files:**
- Create `src/features/quote/DateField.tsx`, `OccupationField.tsx`, `AboutYouStep.tsx`, `LicenceStep.tsx`, `ClaimsStep.tsx`, `NamedDriversStep.tsx` and `drivers.browser.test.tsx`.
- Modify `src/features/quote/quote.css`.

**Interfaces:**
- **Consumes:** Tasks 1–4, `Field`, `Input`, `Select`, `RadioGroup`, `Radio`, `Checkbox`, `Button` and `Card`, and the 4.5c `parseInput`.
- **Produces:** each screen is `(props: { journey: Journey; today: string; onBack: () => void; onDone: () => void }) => JSX.Element`.
  - **When it renders:** its form starts from the stored part, if there is one.
  - **On submit:** it parses with its schema. On failure it shows the errors and focuses the first invalid field (5.2's pattern). On success it calls `setStepAnswers` and then `onDone()`.
  - **The fields:**
    - **`DateField({ id, legend, hint?, error?, value: string | undefined, onChange(iso: string | null, parts) })`:** a `fieldset` with `Day`, `Month` and `Year` inputs (`inputMode="numeric"`; `autoComplete` `bday-day`, `bday-month` and `bday-year` on a date of birth).
    - **`OccupationField({ idPrefix, status, occupation, onChange, errors })`:** a status `Select`; for employed or self-employed, an `Occupation` `Select` from `useQuery(occupationsQuery)` through `jobOptions`. While loading, its placeholder is `Loading occupations…`. A failure shows the Review Focus 3 message with a `Try again` button that calls `refetch`.
    - **A stored key that isn't in the list** shows empty (Review Focus 4).
  - **Ids:** incidents and named drivers get `crypto.randomUUID()` ids, which are their React keys.

- [ ] **Step 1: Write the failing component tests** in `drivers.browser.test.tsx`.
  - **Setup:**
    - Each test gets a fresh `QueryClient`, with the occupations query data seeded from a fixture of 6 occupations that include `plumber`, `retired` and `self_employed`.
    - Each test starts from a `beginJourney` + `setVehicle` journey and `today = "2026-11-11"`.
  - **About you:**
    - **The status:** choosing `Retired` hides `Occupation`, and `Employed` shows it without `Retired` in its options.
    - **Submitting empty** focuses `First name` and shows `Enter your first name.`.
    - **A valid submit** calls `onDone` and stores `mainDriver.occupation`.
  - **The occupation list:**
    - **A failure:** the error and `Try again` show. Retired can still submit.
    - **A key that's gone:** a stored `mainDriver.occupation: "astronaut"` shows the select empty.
  - **Licence and driving:** `Provisional UK` shows `Kerb can’t quote for a provisional licence yet.` on submit, and `onDone` isn't called.
  - **Claims:**
    - **Yes** shows `Date of incident`, and `Add another incident` adds a second set.
    - **Removing** incident 1 leaves incident 2's values in place.
    - **Submitting without the confirmation** shows its error.
  - **Named drivers:**
    - **Yes** shows `Named driver 1`. Adding up to 4 hides `Add another driver`.
    - **Removing driver 2 of 3:** driver 3's first name shows under `Named driver 2`, and focus is on that heading (Review Focus 5).
    - **Removing every driver** sets the question back to No.
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project component src/features/quote/drivers.browser.test.tsx` fails.
- [ ] **Step 3: Implement** the two fields and the four screens. Lay them out in the frames' cards, two columns from tablet width up and one at phone width, with the existing tokens in `quote.css`.
- [ ] **Step 4: Run the tests and see them pass.** The same command passes. Then run the 5.2 file, `vehicle.browser.test.tsx`, which still passes.
- [ ] **Step 5: Commit** with `feat(quote): the about you, licence and driving, claims and named driver screens`.

### Task 6: The flow, the holding view and the route

**Files:**
- Create `src/features/quote/DriverSteps.tsx` and `QuoteHolding.tsx`.
- Modify `src/features/quote/VehicleStep.tsx`, `JourneyShell.tsx`, `src/routes/_site/quote.car.tsx` and `drivers.browser.test.tsx`.

**Interfaces:**
- **Consumes:** Tasks 3 and 5.
- **Produces:**
  - **The car step:** `VehicleStep` gains `onContinue: () => void`. It replaces the confirmed view's slot line with the `Continue` button.
  - **The shell:** `JourneyShell` gains `current?: number` (default 0) for both Steppers.
  - **The flow:** `DriverSteps({ step, onStep(step: QuoteStep | undefined, opts?: { replace?: boolean }) })`. Here `undefined` means the car step.
    - **On mount and on every `step` change:** read the journey and `todayIso()`. If the step isn't reachable, call `onStep(firstIncompleteStep(...), { replace: true })`. `"car"` maps to `undefined`.
    - **Done on a step:**
      - **From the summary:** the visit came from "Edit" (a `from=quote` flag kept in component state, not the URL), and every step passes → `quote`.
      - **Otherwise:** a later step that now fails → that step. If none fails, the next step, and after `drivers` → `quote`.
    - **Focus:** the page's `h1` gets focus on each step change, as 5.2 does between views.
  - **The holding view:** `QuoteHolding({ journey, onEdit(step) })` shows the P3 rows.
  - **The route:**
    - **The car step:** without `step`, `CarQuotePage` renders `VehicleStep` with `onContinue={() => navigate step "about"}`.
    - **A driver step:** with `step`, it renders `DriverSteps`.
    - **The Stepper:** `current` is `step === "quote" ? 1 : 0`.

- [ ] **Step 1: Write the failing component tests** in `drivers.browser.test.tsx`. Render `DriverSteps` with a fake `onStep` that re-renders with the new step.
  - **Blocked links:**
    - `step="drivers"` with no vehicle calls `onStep(undefined, { replace: true })` (Review Focus 1).
    - `step="claims"` with only a vehicle goes to `"about"`.
  - **The happy path:** a full run about → driving → claims → drivers ends on `"quote"`, with the four summary rows.
  - **Re-checking later steps:** from the summary, `Edit` About you → change the date of birth so the stored licence date breaks → `Continue` lands on `driving`, showing the 17th-birthday error.
  - **Returning to the summary:** `Edit` Claims → `Continue` returns to `quote`.
  - **Refresh:** unmounting and mounting again on `driving` shows the stored values.
  - **The URL:** after the full run, `window.location.href` contains none of the typed names.
- [ ] **Step 2: Run the tests and see them fail.** `vp test --project component src/features/quote` fails.
- [ ] **Step 3: Implement** the flow, the holding view and the wiring.
- [ ] **Step 4: Run the tests and see them pass.** The same command passes, `vehicle.browser.test.tsx` included (its "Driver details arrive in 5.3" assertion becomes the `Continue` button).
- [ ] **Step 5: Commit** with `feat(quote): the driver steps in order, re-checked after an edit, ending on the holding quote view`.

### Task 7: E2E, axe, docs and the full check

**Files:**
- Create `e2e/drivers.spec.ts`.
- Modify `e2e/a11y.spec.ts`, `plan/figma.md`, `plan/phases/05-quote/phase.md`, `plan/build-plan.md` and `plan/phases/05-quote/03-driver-steps.md`.

- [ ] **Step 1: Write the E2E test** in `drivers.spec.ts`.
  - **The run:**
    1. Demo plate `VW21 GQL` → confirm → `Continue`.
    2. About you: an adult born in 1991, Employed, a job from the list.
    3. Licence: `Full UK`, 2010, 5 years' no-claims, 8,000 annual and 18,200 current miles, commuting, driveway.
    4. Claims: Yes, one incident, confirmed.
    5. Named drivers: Yes, one driver born 19 years before today, `Full UK` from last year, no claims.
    6. `Get my car quote`.
  - **The checks:**
    - The page shows `Your price arrives in 5.4` and the named driver's name.
    - A reload keeps the view.
    - The URL has no typed name.
  - **axe:** add `?step=about` … `?step=quote` to `a11y.spec.ts`. A cold link redirects, so each one is visited after the run with the answers in place, through a helper that fills the journey in the page's `sessionStorage` before navigating.
- [ ] **Step 2: Run E2E locally** against `vp build && vp preview` (only with Damion's `vp dev` stopped): `pnpm exec playwright test e2e/drivers.spec.ts e2e/a11y.spec.ts`. Expected: they pass at phone and desktop width.
- [ ] **Step 3: Update the docs.**
  - **`figma.md`:**
    - Add a row for 12a, `235:1638`, slice 5.3.
    - Note that `157:10429` is the About you screen.
    - Note that convictions come off 11's sibling screens 12 and 12a.
  - **The spec:**
    - Set its Status line to done.
    - Tick its Done-when items.
  - **`phase.md`:** set the 5.3 row to `done (#NN)`.
  - **`build-plan.md`:** tick 5.3.
- [ ] **Step 4: Run the full check.** `vp check`, `vp test` and `vp build` all pass. Record the unit, integration and component counts in the spec's Done when.
- [ ] **Step 5: Commit** with `test(quote): the driver steps end to end, with axe on each step; docs for 5.3`.

After Task 7, open the PR into `staging` following `plan/git-workflow.md`:
- **Title:** the spec's commit message.
- **Body:** the template, the Done-when list and the preview URL.
- **Attribution:** the Opsed Solutions trailer plus the Claude Code line.

The manual check on staging follows the merge, as in 5.2.
