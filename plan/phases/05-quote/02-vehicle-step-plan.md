# 5.2 Vehicle step: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/quote/car` gets its first real step. A visitor finds a car by demo plate (with a visible fill-in) or by make → model → year → variant from the catalogue, confirms it into the tab's journey object, and the postcode is checked with postcodes.io (cached in `postcode_areas`) before the step shows.

**Architecture:** There are four layers.
1. **Pure rules** in `src/features/quote/`: plate normalising and the demo list, the picker cascade over the catalogue rows, the `vehicle` and `error` search values, and the journey object's `vehicle` and `lastPlate`.
2. **Server:**
   - `GET /api/catalogue`, cached long on the CDN;
   - `checkPostcodeExists` (cache read, limit, postcodes.io, cache write; every failure becomes `unavailable`) behind the `checkPostcode` server function;
   - the `postcode_areas` table.
3. **Components:**
   - `VehicleStep` switches between `PlateLookup` (screen 08), `VehiclePicker` (screen 09) and `VehicleNotFound` (screen 10);
   - `CarNotListed` is the shared panel;
   - TanStack Query serves the catalogue.
4. **Route:** `quote.car.tsx` validates `vehicle`, checks the postcode in a loader keyed on the postcode only, and renders the step inside `JourneyShell`.

**Tech Stack:** TanStack Start / Router 1.170 (`loaderDeps`, `redirect`, `createServerFn`, server route handlers), `@tanstack/react-query` (new), React 19, Zod 4, Drizzle on `pg`, the 4.5c `limit()`, Vitest `unit` / `integration` / `component` projects, Playwright with axe.

**Spec:** [02-vehicle-step.md](02-vehicle-step.md). Read decisions 1–5 and calls 6–16 before starting.

## Global Constraints

- **Route:** `/quote/car`, search keys `postcode` (5.1) and `vehicle` (`"manual"` | `"not-found"`; absent = the registration view). A bad `vehicle` value is dropped. The plate is never in the URL.
- **`/quote` error flag:** `error=postcode` shows `We couldn't find that postcode. Check it and try again.` under the postcode field.
- **The demo plates** (`src/features/quote/demo-plates.ts`, in this order):

  | Plate | Make | Model | Year | Variant |
  |---|---|---|---|---|
  | `VW21 GQL` | Volkswagen | Golf | 2021 | 1.0 TSI Life 5dr |
  | `FD69 KQB` | Ford | Fiesta | 2019 | 1.0 EcoBoost 125 Titanium 5dr |
  | `VX22 CQS` | Vauxhall | Corsa | 2022 | 1.2 Turbo SRi 5dr |
  | `TY23 HIQ` | Toyota | Yaris | 2023 | 1.5 Hybrid Design CVT 5dr |
  | `TS24 EIV` | Tesla | Model 3 | 2024 | RWD |
  | `BM20 MIQ` | BMW | 3 Series | 2020 | 320d M Sport auto |

  The age identifier is the year (`21`), or the year + 50 for September to February (`69` = 2019). The last three letters always include I or Q.
- **Copy, screen 08:**
  - eyebrow `Car · Your details`;
  - title `Let's find your car`;
  - intro `Enter your registration and we'll look up your car's details.`;
  - label `Car registration`, placeholder `KR24 BXL`, hint `Enter the registration exactly as it appears on your number plate.`;
  - demo line `Kerb is a demo, so only these plates are recognised currently. Please choose one:` (Damion, 10 Nov 2026);
  - button `Find my car`, link `I don't know the registration`;
  - panel `No registration to hand?` / `You can choose the make, model, year and variant instead. Check the details against your vehicle documents before continuing.` / `Choose my car manually`;
  - empty-box error `Enter your registration.`
- **Copy, screen 09:**
  - eyebrow `Car · Manual lookup`, or `Car · Your details` after a plate fill;
  - title `Choose your car`;
  - intro `Choose each detail in order. You'll find the exact variant on your vehicle documents.`;
  - labels `1 · Make`, `2 · Model`, `3 · Year first registered`, `4 · Variant`;
  - hints `Choose the manufacturer.` and `Models depend on the make you choose.`;
  - the line `Changing an earlier answer clears the choices that depend on it.`;
  - car card `{make} {model} {variant}` and `{year} · {Fuel} · {doors} doors`;
  - `My car isn't listed`, `Back`, `Confirm this car`.
- **Copy, screen 10:**
  - eyebrow `Car · Lookup help`;
  - title `We don't have that car`;
  - intro `We couldn't match this registration to a car in our records. You can try again or choose your car manually.`;
  - hint `Check every letter and number, then try again.`;
  - notice `No matching car found` / `Your quote is still here. Try the registration again or use manual lookup.`;
  - `Try registration again`;
  - panel `Find it another way` / `Choose the make, model, year and variant. If the exact variant isn't listed, contact us rather than choosing a different car.` / `Choose my car manually`;
  - `Contact us about this car`.
- **Copy, not listed:** `Kerb is a demo with a limited list of cars. Try choosing another car, or email hello@kerb.opsedsolutions.com to ask for a make to be added.` The link is `mailto:hello@kerb.opsedsolutions.com?subject=Please%20add%20my%20car%20to%20Kerb`.
- **Copy, after confirm:** `Your car: {make} {model} {variant}, {year}.` with a `Change` button, and the slot `Driver details arrive in 5.3`.
- **Copy, no JavaScript:** `The car step needs JavaScript turned on.`
- **Fill timing:** 200 ms between make → model → year → variant → card. All at once under `prefers-reduced-motion: reduce`.
- **Catalogue cache:** `Cache-Control: public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400`; a failure sends `503` with `no-store`.
- **Postcode check:**
  - postcodes.io `GET https://api.postcodes.io/postcodes/{postcode without spaces}`, 2,000 ms timeout;
  - limit `{ max: 60, windowSeconds: 3600 }`, key `postcode.lookup:<subject>`, counted only on a cache miss.
- **Storage:** the journey object stays `version: 1` and gains optional `vehicle` and `lastPlate`. A 5.1 object without them still reads.
- **Process:** stage files by name. No `vp build` or component tests while Damion's `vp dev` is running (stale deps cache).

## Calls this plan makes (for Damion to check)

- **P1. No env setting for postcodes.io.** E2E runs against deployed previews, so a local stub can't be reached. The integration tests inject `fetch`, and E2E uses `ZZ1 1ZZ` against the real service. The spec is updated to match.
- **P2. `postcode_areas` sits in `schema/platform.ts`**, beside `rate_limits` and `jobs`. Those are the app-written support tables, and the reference tables are deploy-written and read-only for `kerb_app`.
- **P3. A failed catalogue request sends `503` with `no-store`,** so the CDN never keeps an error for a year.
- **P4. The loader uses `staleTime: Infinity`,** so moving between views or pressing back never runs the check again for the same postcode.
- **P5. "Change" after confirming** clears `vehicle` in the journey object and opens the picker with the car still selected, not the empty registration view.
- **P6. The picker's options come straight from the rows:** make A to Z, model A to Z, year newest first, variant A to Z. Fuel is shown capitalised (`Petrol`, `Diesel`, `Hybrid`, `Electric`).
- **P7. A typed plate goes to `lastPlate` only when "Find my car" misses,** so screen 10 can show it. A demo plate that matches is kept as `vehicle.demoPlate` once the car is confirmed.

## Review Focus

1. **The catalogue request fails or is slow** (cold start, database down). The registration view still renders. "Find my car" shows `Loading cars…` on its button and then works, or shows `We couldn't load the list of cars. Try again in a moment.` with a retry, and the CDN doesn't keep the failure (P3). Test in Tasks 3 and 5.
2. **A stored `vehicle` whose id is no longer in the catalogue** (a deploy deactivated it). It's cleared quietly and the registration view shows. Test in Task 5.
3. **A plate with odd input:** lower case, inner and outer spaces, a dash (`vw21-gql`), or 20 characters. Dashes and spaces are stripped and case ignored. A long string goes to screen 10 and never throws. Test in Task 1.
4. **The fill-in is interrupted** by the visitor changing the make while it's still running. The pending timers are cancelled, so the old car doesn't overwrite the new choice. Test in Task 5.
5. **postcodes.io answers 200 with an unexpected body** (missing `result`, a different postcode). That's `unavailable`, not stored, and the step shows. Test in Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `src/features/quote/plate.ts` (+ test) | `normalisePlate`, `plateError` |
| `src/features/quote/demo-plates.ts` (+ test) | `demoPlates`, `findDemoPlate` |
| `src/features/quote/catalogue.ts` (+ test) | `PickerCar`, the cascade helpers, `findCar`, `fuelLabel` |
| `src/features/quote/search.ts` (+ test) | `carSearch`, `StartSearch.error`, `postcodeNotFoundError` |
| `src/features/quote/journey-store.ts` (+ test) | `VehicleChoice`, `setVehicle`, `setLastPlate` |
| `src/server/db/schema/platform.ts`, `drizzle/0019_*.sql`, `src/server/db/data-contract.ts`, `scripts/check-app-role-core.ts` | `postcode_areas` |
| `src/server/data/postcode-rows.ts` | `findPostcodeArea`, `insertPostcodeArea` (excluded from the permission scan) |
| `src/server/quote/postcode.ts` (+ `.int.test.ts`) | `checkPostcodeExists`, `POSTCODE_LOOKUP_RULE` |
| `src/server/quote/catalogue.ts` (+ `.int.test.ts`) | `catalogueResponse`, `CATALOGUE_CACHE_CONTROL` |
| `src/routes/api/catalogue.ts` | `GET /api/catalogue` |
| `src/features/quote/server.ts` | adds `checkPostcode` |
| `src/router.tsx`, `src/features/quote/catalogue-query.ts` | `QueryClient`, `catalogueQuery` |
| `src/features/quote/VehicleStep.tsx`, `PlateLookup.tsx`, `VehiclePicker.tsx`, `VehicleNotFound.tsx`, `CarNotListed.tsx`, `quote.css` | screens 08–10 |
| `src/features/quote/vehicle.browser.test.tsx` | component tests |
| `src/features/quote/JourneyShell.tsx`, `QuoteStart.tsx`, `src/routes/_site/quote.car.tsx`, `quote.index.tsx` | wiring |
| `e2e/vehicle.spec.ts`, `e2e/a11y.spec.ts` | E2E |
| `plan/engineering.md`, `plan/figma.md`, `plan/phases/05-quote/phase.md`, `plan/build-plan.md`, the spec | docs |

---

### Task 1: Plates, demo list, cascade and search rules

**Files:**
- Create `src/features/quote/plate.ts`, `demo-plates.ts`, `catalogue.ts` and a `.test.ts` for each.
- Modify `src/features/quote/search.ts` and `search.test.ts`, and `src/server/reference/catalogue/catalogue.test.ts`.

**Interfaces (Produces):**
- `normalisePlate(input: string): string`: upper case, spaces and dashes removed (`"vw21-gql "` → `"VW21GQL"`).
- `plateError = "Enter your registration."`
- `interface DemoPlate { plate: string; make: string; model: string; year: number; variant: string }`. `plate` is shown with its space, as `"VW21 GQL"`.
- `demoPlates: readonly DemoPlate[]`, in the Global Constraints order.
- `findDemoPlate(input: string): DemoPlate | null`, which compares `normalisePlate` on both sides.
- `interface PickerCar { id: string; make: string; model: string; year: number; variant: string; fuelType: string; doors: number; transmission: string }`
- `makesOf(cars): string[]`, `modelsOf(cars, make): string[]`, `yearsOf(cars, make, model): number[]` (newest first), `variantsOf(cars, make, model, year): PickerCar[]`. All deduplicated and sorted as P6 says.
- `findCar(cars, { make, model, year, variant }): PickerCar | null`
- `fuelLabel(fuelType: string): string` (`"petrol"` → `"Petrol"`)
- `carSearch(raw): { postcode?: string; vehicle?: "manual" | "not-found" }`
- `StartSearch` gains `error?: "postcode"`. `startSearch` keeps it only when the value is exactly `"postcode"`.
- `postcodeNotFoundError = "We couldn't find that postcode. Check it and try again."`

- [ ] **Step 1: Write the failing tests**
  - `plate.test.ts`:
    - `normalisePlate("vw21-gql ")` is `"VW21GQL"`;
    - `normalisePlate(" v w 2 1 g q l")` is `"VW21GQL"`;
    - a 20-character input comes back normalised without throwing.
  - `demo-plates.test.ts`:
    - there are six plates;
    - each `plate` matches `/^[A-Z]{2}\d{2} [A-Z]{3}$/`, and its last three letters match `/[IQ]/`;
    - the age identifier `n` meets `n === year % 100 || n === (year % 100) + 50`;
    - `findDemoPlate("vw21gql")?.model` is `"Golf"`;
    - `findDemoPlate("KR24 BXL")` is `null`.
  - `catalogue.test.ts`, with a fixture of five `PickerCar`s over two makes:
    - `makesOf` is A to Z and unique;
    - `yearsOf` is newest first;
    - `variantsOf` returns only that make, model and year;
    - `findCar` finds the exact row and gives `null` for an unknown variant;
    - `fuelLabel("electric")` is `"Electric"`.
  - `search.test.ts`:
    - `carSearch({ postcode: "e83rl", vehicle: "manual" })` is `{ postcode: "E8 3RL", vehicle: "manual" }`;
    - `vehicle: "garage"`, `vehicle: 1` and a missing `vehicle` all give `vehicle: undefined`;
    - `startSearch({ error: "postcode" }).error` is `"postcode"`, and `startSearch({ error: "x" }).error` is `undefined`.
  - `src/server/reference/catalogue/catalogue.test.ts`: for each `demoPlates` entry, `expandCatalogue(...)` has exactly one row with the same make, model, year and variant.
- [ ] **Step 2: Run them and see them fail.** `vp test --project unit src/features/quote src/server/reference/catalogue` fails on the missing modules.
- [ ] **Step 3: Implement** the four modules. `carSearch` returns both keys every time (5.1's note: a key left out brings the raw value back).
- [ ] **Step 4: Run them and see them pass.** The same command passes.
- [ ] **Step 5: Commit.** `git add` each file by name, then `git commit -m "feat(quote): demo plates, plate normalising, the catalogue cascade and the car step's search values"`.

### Task 2: `postcode_areas` and the postcode check

**Files:**
- Modify `src/server/db/schema/platform.ts`, `src/server/db/data-contract.ts`, `scripts/check-app-role-core.ts`, `src/server/data/permissions.int.test.ts` (exclusion list), `src/features/quote/server.ts`.
- Create `drizzle/0019_*.sql` (`vp run db:generate`, then append the revoke), `src/server/data/postcode-rows.ts`, `src/server/quote/postcode.ts`, `src/server/quote/postcode.int.test.ts`.

**Interfaces (Produces):**
- **The table** `postcodeAreas`, called `postcode_areas`:
  - columns `postcode` (text, primary key, normalised `E8 3RL`), `outcode`, `adminDistrict` (nullable), `region` (nullable), `country` and `lookedUpAt` (`timestamptz`, default now);
  - the migration ends with `REVOKE UPDATE, DELETE ON postcode_areas FROM kerb_app;`.
- **The data contract:**
  - grain `one UK postcode confirmed by postcodes.io`, `primaryKey: ["postcode"]`, `changeColumn: null`, `kind: "append-only"`, `copied: false`;
  - columns `postcode: "drop"`, the rest `keep`.
- **The data rows:**
  - `findPostcodeArea(postcode: string, db?: Db): Promise<boolean>`;
  - `insertPostcodeArea(row: { postcode; outcode; adminDistrict: string | null; region: string | null; country: string }, db?: Db): Promise<void>` (`onConflictDoNothing`).
- **The check:**
  - `type PostcodeCheck = "found" | "not_found" | "unavailable"`;
  - `POSTCODE_LOOKUP_RULE = { max: 60, windowSeconds: 60 * 60 }`;
  - `checkPostcodeExists(postcode: string, headers: Headers, deps?: { fetch?: typeof fetch; secret?: string; timeoutMs?: number }): Promise<PostcodeCheck>`.
- **The server function:** `checkPostcode`, a POST `createServerFn` with `publicMiddleware`, taking `{ postcode: string }` and returning `{ result: PostcodeCheck }`.

**How `checkPostcodeExists` works:**
1. `normalisePostcode`; null → `not_found`.
2. Cache read; a hit → `found`, and a throw → `unavailable`.
3. `rateLimitSubject` + `limit()`; any throw → `unavailable`.
4. `fetch` with `AbortSignal.timeout(timeoutMs ?? 2000)`:
   - `404` → `not_found`;
   - `200` whose `result.postcode` normalises to the same postcode → insert (a failed insert is ignored) → `found`;
   - anything else, or a throw → `unavailable`.

It never throws.

- [ ] **Step 1: Write the failing integration tests** in `postcode.int.test.ts`. `truncateAll` runs before each test, with a `vi.fn()` fetch.
  - A miss calls fetch once, with the URL `https://api.postcodes.io/postcodes/E83RL`; a 200 body gives `found` and one `postcode_areas` row.
  - A second call for `e8 3rl` gives `found` and doesn't call fetch again.
  - A 404 gives `not_found` and stores no row.
  - A 500, a rejected fetch, a timeout (fetch never resolves, `timeoutMs: 50`), and a 200 with `{}` or a different postcode all give `unavailable` and store no row.
  - After 60 misses from one IP, the 61st gives `unavailable` without calling fetch. A cached postcode after that still gives `found`.
  - A bad postcode (`"hello"`) gives `not_found` without calling fetch.
  - `UPDATE` and `DELETE` on `postcode_areas` through `getDb()` are refused. The tests run as `kerb_app`; rows are inserted as needed with `getOwnerDb()`.
- [ ] **Step 2: Run and see them fail.** `vp test --project integration src/server/quote/postcode.int.test.ts` fails.
- [ ] **Step 3: Implement** the schema, migration, contract entry, rows and check.
  - `check-app-role-core.ts` gains the result `"updates on postcode_areas refused"`.
  - `postcode-rows.ts` joins the permission scan's exclusions, with a comment saying it holds the guest postcode cache (5.2).
- [ ] **Step 4: Run and see them pass.** The same command passes. Then run `vp test --project unit src/server/db` (the data-contract test) and `vp run db:check`, which also pass.
- [ ] **Step 5: Commit** with `feat(quote): check postcodes with postcodes.io, cached in postcode_areas and limited per IP`.

### Task 3: The catalogue API and TanStack Query

**Files:**
- Create `src/server/quote/catalogue.ts`, `catalogue.int.test.ts`, `src/routes/api/catalogue.ts` and `src/features/quote/catalogue-query.ts`.
- Modify `src/router.tsx` and `package.json` (`pnpm add @tanstack/react-query`, pinned to an exact version like the router).

**Interfaces:**
- **Consumes:** `getCatalogue(db)`, `CatalogueRecord` (`src/server/data/reference.ts`), and `PickerCar` (Task 1).
- **Produces:**
  - `CATALOGUE_CACHE_CONTROL`, the string from Global Constraints;
  - `catalogueResponse(db?: Db): Promise<Response>`, which returns the JSON `{ cars: PickerCar[] }` or a `503` with `no-store` on any error;
  - `catalogueQuery = queryOptions({ queryKey: ["catalogue"], queryFn, staleTime: Infinity, gcTime: Infinity })`. Its `queryFn` fetches `/api/catalogue` and throws on a response that isn't OK;
  - `getRouter()` makes one `QueryClient` per call and wraps the app in `QueryClientProvider` through the router's `Wrap` option.

- [ ] **Step 1: Write the failing tests** in `catalogue.int.test.ts`. Insert three `vehicle_catalogue` rows with `getOwnerDb()` (`src/test/db.ts`), one with `is_active = false`, and call `clearReferenceCaches()` before each test.
  - The response is 200, its `Cache-Control` equals `CATALOGUE_CACHE_CONTROL`, and its body has only the two active cars.
  - Each car has exactly the `PickerCar` keys, so no `valuePence` or `insuranceGroup` reaches the browser.
  - With a db whose `select` throws: status 503 and `Cache-Control: no-store`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the response, the route (`server.handlers.GET: () => catalogueResponse()`), the query options and the router's `Wrap`.
- [ ] **Step 4: Run and see them pass.** Run `vp check` too, because the route tree regenerates.
- [ ] **Step 5: Commit** with `feat(quote): the catalogue API with a long CDN cache, and TanStack Query`.

### Task 4: The journey object's car

**Files:** Modify `src/features/quote/journey-store.ts` and `journey-store.test.ts`.

**Interfaces (Produces):**
- `interface VehicleChoice { catalogueVariantId: string; make: string; model: string; year: number; variant: string; fuelType: string; doors: number; demoPlate?: string }`
- `Journey` gains `vehicle?: VehicleChoice` and `lastPlate?: string` (optional fields in `journeySchema`, still `version: 1`).
- `setVehicle(vehicle: VehicleChoice | null, storage?)`: writes it into the car journey, and `null` removes it.
- `setLastPlate(plate: string, storage?)`

Both are no-ops when there's no car journey, and never throw.

- [ ] **Step 1: Write the failing tests.**
  - A 5.1 object (no `vehicle`) still reads.
  - `setVehicle` then `readJourney("car")` round-trips the choice.
  - `setVehicle(null)` removes it.
  - `setLastPlate("KR24BXL")` round-trips.
  - A `vehicle` with `year: "2021"` (a string) makes the whole object read as `null`, as 5.1's corrupt-value rule says.
  - Both functions survive storage throwing on `setItem`.
- [ ] **Step 2: Run and see them fail.** `vp test --project unit src/features/quote/journey-store.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** with `feat(quote): the journey object keeps the chosen car and the last plate`.

### Task 5: Screens 08–10 and the picker

**Files:**
- Create `src/features/quote/VehicleStep.tsx`, `PlateLookup.tsx`, `VehiclePicker.tsx`, `VehicleNotFound.tsx`, `CarNotListed.tsx` and `vehicle.browser.test.tsx`.
- Modify `quote.css`.

**Interfaces:**
- **Consumes:** Tasks 1, 3 and 4.
- **Produces:**
  - `VehicleStep({ view, onView }: { view: "plate" | "manual" | "not-found"; onView: (view) => void })`. It reads and writes the journey object, uses `useQuery(catalogueQuery)`, and on confirm calls `setVehicle` and then shows the confirmed state from the Global Constraints.
  - `VehiclePicker({ cars, fillFrom, initial, onConfirm, onBack, fromPlate })`. `fillFrom` is a `PickerCar` to fill in step by step, and `initial` is a `PickerCar` to start selected (P5).
- **Components:** the existing `Select`, `Input`, `Button`, `Card` and `Alert` (or the 2.4 notice component). Layout as screens 08–10. The plate buttons use the same yellow plate style as the input.

- [ ] **Step 1: Write the failing component tests** in real Chromium. Seed a `QueryClient` with `setQueryData(["catalogue"], { cars: fixture })`, where the fixture includes the Golf from `demoPlates` and a second Golf year, and clear `sessionStorage` before each test.
  - Clicking the `VW21 GQL` button fills the box and doesn't open the picker.
  - "Find my car" with `vw21gql`: within 2 s, Make is `Volkswagen`, Model `Golf`, Year `2021`, Variant `1.0 TSI Life 5dr`, the card reads `Volkswagen Golf 1.0 TSI Life 5dr`, and the eyebrow is `Car · Your details`.
  - With `page.emulateMedia({ reducedMotion: "reduce" })` (or a `matchMedia` stub), all four are set within the first animation frame.
  - Changing the make to another value while the fill is running leaves model, year and variant empty 1 s later.
  - `KR24 BXL` calls `onView("not-found")` and stores `lastPlate`; screen 10 shows `KR24 BXL` in the box.
  - An empty box shows `Enter your registration.`
  - Changing the make clears model, year and variant.
  - `Confirm this car` is disabled until a variant is chosen.
  - `My car isn't listed` shows the message and a link whose `href` is the `mailto` from Global Constraints.
  - Confirming writes `vehicle` and shows `Your car: Volkswagen Golf 1.0 TSI Life 5dr, 2021.`
  - A stored `vehicle` whose id isn't in the fixture is removed, and the registration view shows.
  - A query in the error state shows the "couldn't load" message with a working `Try again`.
- [ ] **Step 2: Run and see them fail.** Check Damion's `vp dev` isn't running, then run `vp test --project component src/features/quote/vehicle.browser.test.tsx`.
- [ ] **Step 3: Implement.**
  - The fill uses a chain of `setTimeout`s stored in a ref and cleared on any manual change and on unmount.
  - Reduced motion is read with `matchMedia("(prefers-reduced-motion: reduce)")`.
- [ ] **Step 4: Run and see them pass.** Run `vp test --project component src/features/quote` so 5.1's tests run too.
- [ ] **Step 5: Commit** with `feat(quote): the car step's registration, picker and not-found screens`.

### Task 6: Wiring the route, the shell and `/quote`

**Files:** Modify `src/routes/_site/quote.car.tsx`, `quote.index.tsx`, `src/features/quote/JourneyShell.tsx`, `QuoteStart.tsx` and `quote.browser.test.tsx`.

**Interfaces:**
- **Consumes:** `carSearch`, `checkPostcode`, `VehicleStep`, `postcodeNotFoundError`.
- **The route `quote.car.tsx`:**
  - `validateSearch: carSearch`;
  - the existing `beforeLoad`;
  - `loaderDeps: ({ search }) => ({ postcode: search.postcode })` and `staleTime: Infinity`;
  - the loader calls `checkPostcode`, with a rejection treated as `unavailable`. On `not_found` it throws `redirect({ to: "/quote", search: { type: "car", postcode, error: "postcode" } })`.
- **`JourneyShell`:** takes optional `children`, rendered in place of the "arrives" card. Home still shows `This step arrives in 5.7`. The car route passes `<VehicleStep>` plus a `<noscript>` holding the no-JavaScript line, and `onView` navigates with `search: (s) => ({ ...s, vehicle })`, where `plate` maps to `undefined`.
- **`QuoteStart`:** shows `postcodeNotFoundError` on the postcode field when `error === "postcode"`, until the visitor submits again.

- [ ] **Step 1: Write the failing component test** in `quote.browser.test.tsx`: `QuoteStart` with `error: "postcode"` and `postcode: "ZZ1 1ZZ"` shows the error and keeps the value. (The route's redirect is covered by E2E in Task 7.)
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see it pass.** Run `vp check` and `vp test` too: the unit, integration and component projects all pass.
- [ ] **Step 5: Commit** with `feat(quote): the car journey shows the vehicle step after the postcode check`.

### Task 7: E2E, accessibility and docs

**Files:**
- Create `e2e/vehicle.spec.ts`.
- Modify `e2e/a11y.spec.ts`, `plan/engineering.md` (§5 CDN caching and the external-calls row), `plan/figma.md` (screen 08's plate is a placeholder only), the spec (Status), `phase.md` (5.2 row: `done (#NN)`) and `build-plan.md` (5.2 box).

- [ ] **Step 1: Write the E2E tests.**
  - Demo plate:
    1. `/quote/car?postcode=E8 3RL`.
    2. Click the `VW21 GQL` button, then `Find my car`.
    3. Make `Volkswagen` … Variant `1.0 TSI Life 5dr`.
    4. `Confirm this car` shows `Your car: …`.
    5. A reload still shows it.
  - Unknown plate:
    1. `AB12 CDE`, then `Find my car`.
    2. The URL has `vehicle=not-found` and no plate.
    3. `Choose my car manually`, then pick Ford / Fiesta / 2019 / `1.0 EcoBoost 125 Titanium 5dr`.
    4. Confirm.
    5. The back button returns through the views without a second postcode check. Assert no extra `checkPostcode` request with `page.on("request")`.
  - A made-up postcode: `/quote/car?postcode=ZZ1 1ZZ` lands on `/quote?type=car…&error=postcode` with the error text.
  - Axe on the registration, picker and not-found views at 390 px and 1280 px wide.
- [ ] **Step 2: Run against a local preview.** Check Damion's `vp dev` isn't running, then run `vp build && vp preview`, and `BASE_URL=http://localhost:4173 vp exec playwright test e2e/vehicle.spec.ts e2e/a11y.spec.ts`. They pass. Locally, the postcode check may come back `unavailable` without a database. The made-up-postcode test then needs `DATABASE_URL` set, or `test.skip` when `!process.env.BASE_URL?.startsWith("https")` with a comment saying why.
- [ ] **Step 3: Update the docs** listed above. Mark the "Done when" boxes only after `ci` and the staging check.
- [ ] **Step 4: Run the full checks.** `vp check`, `vp test` and `vp build` all pass.
- [ ] **Step 5: Commit** with `test(quote): car step journeys and axe; docs for 5.2`.
