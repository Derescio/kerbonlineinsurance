# 5.4b Journey revamp: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The car journey in the Revamp frames (R01–R10): its own journey header and footer on `/quote`, details tabs, a "Your car" card on every car page, the pay-annually-or-monthly choice on Your quote, and a named-driver review step. No question, check, rule or price changes.

**Architecture:** There are three layers.
1. **The frame:** the quote routes move out of `_site` into a pathless `_quote` layout with `QuoteFrame` (demo bar, journey header with the Stepper, `main`, slim footer). The Stepper leaves `JourneyShell` and the frame works out the current step from the URL.
2. **Shared page parts** in `src/features/quote/page-kit.tsx`: the two-column `JourneyPage`, `DetailsTabs`, `CarCard`, `HelpCard` and `StepNav`. Every car view is laid out with them.
3. **The views:** `VehicleStep` (registration, R01, not-found, R02), the four driver steps (R03–R08), `QuoteHolding` (R09) and a new `DriverReview` (R10), restyled and reworded. The journey store gains an optional `payment` part.

**Tech Stack:** TanStack Start 1.170 / Router file routes, React 19, `@tanstack/react-query`, Zod 4, plain CSS in `quote.css` with the design tokens, Vitest `unit` and `component` (real Chromium) projects, Playwright with axe.

**Spec:** [04b-journey-revamp.md](04b-journey-revamp.md). Read decisions 1–4 and calls 5–14 before starting. Screenshots of R01–R10 are in Figma page `249:5806`.

## Global Constraints

- **Nothing in `src/features/rating/`, `src/server/` or the step schemas changes.** A test that needs a price or rule change is a sign something is wrong; stop and raise it.
- **URLs don't change:** `/quote`, `/quote/car?postcode=…&vehicle=…&step=…`, `/quote/home`, `/quote/coming-soon`. Only route ids change (`/_site/quote/car` → `/_quote/quote/car`).
- **No answer goes in the URL**, and `payment` doesn't either (5.3, call 5).
- **Help links:** `HELP_EMAIL = "hello@kerb.opsedsolutions.com"`, opened as `mailto:`. Move `CarNotListed`'s `HELLO` constant to `src/features/quote/help.ts` and reuse it. No Accessibility link anywhere.
- **Overlines** read `Car insurance / Your details` and `Car insurance / Your quote` (shown in capitals by CSS, as drawn).
- **Copy, exactly** (curly apostrophes, `&rsquo;` in JSX):
  - **Help card (details steps, R01–R08):** title `A little help along the way`, line `Keep your vehicle documents and driving licence nearby as you complete your details.`; on Claims (R05/R06) the line is `Include incidents even if you didn’t claim, and whether or not you were at fault.`; on Named drivers (R07/R08) `Only people listed on your policy will be covered to drive your car.`. Link `Contact us`.
  - **Help card (R09):** title `Need a hand?`, the details-steps line. **(R10):** title `Need a hand?`, line `You can review your driver details or contact us to talk through the next steps.`
  - **Footer:** `Kerb is a fictional insurer made for a portfolio project. No real cover is sold.` then `Privacy`, `Cookies`, Cookie settings (when PostHog runs), `Help`.
  - **Header:** `Need help?`.
  - **R01:** h1 `Choose your car`; intro `Choose each detail in order. You’ll find the exact variant on your vehicle documents.`; card title `Vehicle details`; label `Year first registered`; hint `Changing an earlier answer clears the choices that depend on it.`; link `My car isn’t listed`; button `Confirm this car`.
  - **R02:** h1 `Your car, confirmed`; intro `Check these details before moving on to your information.`; card `Is this your car?`, then `{make} {model} {variant}`, `{year} · {fuel} · {doors} doors`, `Check the model and variant against your vehicle documents.`; buttons `Change car`, `Continue to your details`.
  - **R03:** h1 `Tell us about you`; intro `We’ll use this information to build your quote for the {year} {make} {model}.`; cards `About you`, `Home address` (ends `Home postcode: {postcode}`); button `Continue to your licence`.
  - **R04:** h1 `Your licence and driving`; intro `A few more details about {firstName} {lastName} and how the {make} {model} is used.`; cards `Your driving licence`, `How you use your car`; button `Continue to claims`.
  - **R05/R06:** h1 `Your driving history`; intro `Tell us about the main driver’s history, including incidents at a previous insurer.`; button `Continue to named drivers`.
  - **R07/R08:** h1 `Who else will drive your car?`; intro `Add anyone else who needs to drive the {make} {model}. You’ll remain the main driver.`; button `Get my car quote`.
  - **R09:** h1 `Your quote is ready`; intro `Comprehensive car insurance for your {make} {model} {variant}.`; card `Your Comprehensive price`, `Choose how you’d like to pay`; `Pay annually` / `One payment for the year` / `{£} /year` / `Total payable {£}`; `Pay monthly` / `12 monthly payments` / `{£} /month` / `Total payable {£×12}`; `Premiums include Insurance Premium Tax.`; button `Choose cover`; holding line `Choosing your cover arrives in 5.5`; section `Your details at a glance`; link `Back to your details`.
  - **R10 declined:** h1 `Let’s review your named driver`; intro `We can’t offer cover with {name} as a named driver.`; warning title `We can’t offer cover with {name} included`, line `You can remove {name} to see a price without them, or review the details you entered.`
  - **R10 referred:** intro `We need to check a couple of things before we can include {name}.`; warning title `We need to check a couple of things about {name}`, line `You can remove {name} to see a price now, or review the details you entered.`
  - **R10 both:** `What happens if you remove {name}?`, `{name} won’t be covered to drive your car. Only continue without them if they don’t need to drive it.`; buttons `Remove {name} and see my price`, `Review named driver details`.
  - **Kept from 5.4:** `{name} has been removed from this quote.` / `Add {name} back`; the plain referred/declined lines; loading, failure and rate-limited lines.
- **A clause about an unanswered part is dropped**, never shown blank (call 13): R03's intro without a car is `We’ll use this information to build your quote.`; R04's without a name is `A few more details about how the {make} {model} is used.`
- **Breakpoints:** reuse `quote.css`'s existing phone breakpoint for the bar Stepper; the two columns stack below 960 px. Nothing scrolls sideways at 360 px.
- **Commits:** stage files by name; every commit ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`.
- **Before component tests or `vp build`:** check port 3000; if `vp dev` is running, ask Damion first.

## Review Focus

1. **A refresh on any step** (sessionStorage restored after hydration). The "Your car" card, tabs and pay choice must show the stored state, not flash empty and stay empty. Tests in Tasks 2, 3 and 5.
2. **A tab link to a step that was done, after an edit broke an earlier step.** The tab must not become a way to skip ahead: a tab past the first unfinished step is plain text, and following an old link still runs 5.3's `reachable()`. Test in Task 2.
3. **"Change car or postcode" from R09** with a full journey. The car is cleared, the driver answers stay, and choosing a car again leads on to About you with them intact. Test in Task 3.
4. **R10 on a narrow phone** with a long first name ("Maximilian-Alexander"). The buttons wrap without overflowing at 360 px. Covered by Task 7's manual check and axe run; a component test sets a 360 px viewport in Task 6.
5. **JavaScript off on `/quote`.** The start form still works as a GET (5.1, call 7) inside the new frame, and the frame's header and footer render on the server. Test in Task 1 (existing no-JS test kept) and the E2E in Task 7.

---

### Task 1: The journey frame and the `_quote` layout

**Files:**
- Create `src/routes/_quote.tsx`; `src/features/quote/QuoteFrame.tsx`; `src/features/quote/frame.ts`; `src/features/quote/frame.test.ts`; `src/features/quote/help.ts`; `src/features/quote/frame.browser.test.tsx`.
- Move `src/routes/_site/quote.tsx`, `quote.index.tsx`, `quote.car.tsx`, `quote.home.tsx`, `quote.coming-soon.tsx` to `src/routes/_quote/` (same file names); update each `createFileRoute` id; regenerate `routeTree.gen.ts` (`vp dev` or the router CLI does it on build).
- Modify `src/features/quote/JourneyShell.tsx` (remove both Steppers), `src/features/quote/CarNotListed.tsx` (import `HELP_EMAIL`), `src/features/quote/quote.css`, `src/features/quote/quote.browser.test.tsx` (the JourneyShell Stepper tests move to `frame.browser.test.tsx`).

**Interfaces:**
- **Produces:**
  - `help.ts`: `export const HELP_EMAIL = "hello@kerb.opsedsolutions.com"; export const helpHref = \`mailto:${HELP_EMAIL}\`;`
  - `frame.ts`: `journeyStepOf(pathname: string, search: { step?: string }): number | null`: `null` for `/quote` and `/quote/coming-soon`; `1` for `/quote/car` with `step === "quote"`; `0` for any other `/quote/car` or `/quote/home`.
  - `QuoteFrame({ pathname, search, children })`: skip link → demo bar (`demoNotice`, same markup and class as `SiteLayout`) → header (wordmark link `/`, wide `Stepper` + narrow bar `Stepper` with the visible text `Step {n} of 4: {label}` when `journeyStepOf` isn't null, `Need help?` link to `helpHref`) → `ClosureBanner` → `<main id="main" tabIndex={-1}>` → footer.
  - `JOURNEY_STEPS` stays exported from `JourneyShell.tsx`.

- [ ] **Step 1: Write the failing unit test** `frame.test.ts`: `journeyStepOf("/quote", {})` → `null`; `("/quote/coming-soon", {})` → `null`; `("/quote/car", {})` → `0`; `("/quote/car", { step: "drivers" })` → `0`; `("/quote/car", { step: "quote" })` → `1`; `("/quote/home", {})` → `0`; a trailing slash (`"/quote/car/"`) → `0`.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/frame.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `frame.ts` and `help.ts`.
- [ ] **Step 4: Run** the unit test. Expected: PASS.
- [ ] **Step 5: Write the failing component tests** in `frame.browser.test.tsx` (render `QuoteFrame` directly):
  - `it("has the demo bar, skip link, header, main and the slim footer")`: `getByRole("region", { name: "Demo notice" })` has `demoNotice`; link `Skip to content` → `#main`; `getByRole("main")` has id `main`; `getByRole("contentinfo")` has the footer line, links `Privacy` (`/privacy`), `Cookies` (`/cookies`), `Help` (`mailto:hello@kerb.opsedsolutions.com`), and **no** `Accessibility` link.
  - `it("shows the Stepper on a car step, current from the URL")` at `/quote/car?step=quote`: `getByRole("navigation", { name: "Quote progress" })` has `aria-current="step"` on `Your quote`.
  - `it("shows no Stepper on the start page")` at `/quote`: no `Quote progress` navigation or progressbar.
  - `it("shows the bar and 'Step 1 of 4: Your details' on a phone")` at 360 px, `/quote/car`.
  - `it("links Need help? to the inbox")`.
- [ ] **Step 6: Run** `vp test --project component src/features/quote/frame.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 7: Implement** `QuoteFrame` and `_quote.tsx` (`createFileRoute("/_quote")`, component reads `useLocation()` and `useSearch({ strict: false })` and renders `QuoteFrame` around `<Outlet />`); move the five routes; remove `site-container` wrapping only if the frame provides it. Reuse `CookieSettings` from `SiteFooter`. Remove the Steppers from `JourneyShell`; keep its `quote.started` effect and its postcode line.
- [ ] **Step 8: Run** the frame tests and `vp test --project component src/features/quote/quote.browser.test.tsx`. Expected: PASS (the moved Stepper tests now live in `frame.browser.test.tsx`; "puts a step in the slot" and the `quote.started` tests unchanged).
- [ ] **Step 9: Commit** `feat(quote): the journey frame on /quote, with its own header, Stepper and slim footer`.

### Task 2: Shared page parts, the tabs and the pay part of the journey

**Files:**
- Create `src/features/quote/page-kit.tsx`, `src/features/quote/page-kit.browser.test.tsx`.
- Modify `src/features/quote/journey-store.ts` (+ `journey-store.test.ts`), `src/features/quote/steps.ts` (+ `steps.test.ts`), `src/features/quote/quote.css`.

**Interfaces:**
- **Consumes:** `firstIncompleteStep`, `DRIVER_STEPS`, `DriverStep` from `steps.ts`; `helpHref` (Task 1).
- **Produces:**
  - `journey-store.ts`: `Journey.payment?: "annual" | "monthly"` (stored part, parsed alone like the others: a bad value drops just it); `setPayment(product: BuyableProductId, payment: "annual" | "monthly"): void`.
  - `steps.ts`: `type DetailsTab = "car" | DriverStep`; `type TabState = "done" | "open" | "current" | "locked"`; `DETAILS_TABS: readonly DetailsTab[] = ["car", "about", "driving", "claims", "drivers"]`; `tabStates(journey: Journey | null, current: DetailsTab, today: string): Record<DetailsTab, TabState>`. The current tab is `current`. Otherwise a complete step is `done`; the first incomplete step is `open` (reachable, no tick); every step after it is `locked`.
  - `page-kit.tsx`:
    - `JourneyPage({ heading: ReactNode, tabs?: ReactNode, aside: ReactNode, children })`: heading, then tabs, then a two-column grid (`.quote-page__main`, `.quote-page__aside`).
    - `DetailsTabs({ states: Record<DetailsTab, TabState>, onOpen: (tab: DetailsTab) => void })`: `<nav aria-label="Your details">`, an `ol` of five items labelled `Car`, `About you`, `Driving`, `Claims`, `Drivers`; `done` → a button with a tick icon (accessible name `{label}, done`); `open` → a button without a tick; `current` → text with `aria-current="step"`; `locked` → plain text.
    - `CarCard({ car: CarCardCar | null, postcode: string, onChange?: () => void, compact?: boolean })` where `CarCardCar = { make: string; model?: string; variant?: string; year?: number; fuelType?: string; doors?: number }`; overline `Your car`; renders only the parts given; `Change car or postcode` button when `onChange` is set.
    - `HelpCard({ title?: string, children: ReactNode })`: default title `A little help along the way`, link `Contact us` → `helpHref`.
    - `StepNav({ onBack?: () => void, backLabel?: string, next: ReactNode })`: Back (arrow, link style, default label `Back`) left, `next` right.
  - `StepHeading` (in `step-kit.tsx`) keeps its props; overline text is passed by callers.

- [ ] **Step 1: Write failing unit tests**:
  - `journey-store.test.ts`: `setPayment("car", "monthly")` then `readJourney("car").payment === "monthly"`; a stored `payment: "weekly"` drops only `payment`.
  - `steps.test.ts`, `tabStates`:
    - complete to `claims` (drivers missing), current `about` → `{ car: "done", about: "current", driving: "done", claims: "done", drivers: "open" }`;
    - no car, current `car` → `{ car: "current", about: "locked", driving: "locked", claims: "locked", drivers: "locked" }`;
    - an edit broke `driving`, current `drivers` → `{ car: "done", about: "done", driving: "open", claims: "locked", drivers: "current" }`.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/journey-store.test.ts src/features/quote/steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `setPayment`, the `payment` part, `DetailsTab`, `DETAILS_TABS`, `tabStates` returning `"done" | "open" | "current" | "locked"`.
- [ ] **Step 4: Run** the unit tests. Expected: PASS.
- [ ] **Step 5: Write failing component tests** in `page-kit.browser.test.tsx`:
  - `DetailsTabs`: `done` is a button named `Car, done` and calls `onOpen("car")`; `current` has `aria-current="step"` and isn't a button; `locked` isn't a button.
  - `CarCard`: with `{ make: "Tesla" }` shows `Tesla` and the postcode, no year line; with the full car shows `Tesla Model 3 RWD` and `2024 · Electric · 4 doors`; `Change car or postcode` calls `onChange`; with `car: null` shows only `Postcode E8 3RL`.
  - `HelpCard`: `Contact us` → `mailto:hello@kerb.opsedsolutions.com`.
- [ ] **Step 6: Run** them. Expected: FAIL.
- [ ] **Step 7: Implement** `page-kit.tsx` and its CSS (cards in the existing `Card` component; the aside card tinted with the existing success-tint token as drawn; columns stack below 960 px; at phone width `CarCard compact` renders one line `{make} {model} {variant} · {postcode} · Change`; the tabs `ol` scrolls sideways with `scroll-snap`, and the current tab is scrolled into view on mount).
- [ ] **Step 8: Run** the page-kit tests. Expected: PASS.
- [ ] **Step 9: Commit** `feat(quote): page parts for the revamp: details tabs, Your car card, help card, step nav, and the pay choice in the journey`.

### Task 3: The car step (registration, R01, not found, R02)

**Files:**
- Modify `src/features/quote/VehicleStep.tsx`, `VehiclePicker.tsx`, `PlateLookup.tsx`, `VehicleNotFound.tsx`, `src/routes/_quote/quote.car.tsx`, `quote.css`, `vehicle.browser.test.tsx`, `e2e/vehicle.spec.ts`.

**Interfaces:**
- **Consumes:** `JourneyPage`, `DetailsTabs`, `tabStates`, `CarCard`, `HelpCard`, `StepNav` (Task 2).
- **Produces:**
  - `VehiclePicker` gains `onChoiceChange?: (car: CarCardCar | null) => void`, called with whatever is picked so far (make; make + model; + year; + variant's fields) and `null` when cleared.
  - `VehicleStep` gains `onBack: () => void` (registration's Back → `/quote?type=car&postcode=…`, wired in the route) and `onTab: (tab: DetailsTab) => void` (the route navigates to `step=tab`, or to the car step for `car`).
  - R02's Back returns to the view the car was chosen on. Keep `chosenFrom: "plate" | "manual"` in state: `"plate"` when a demo plate filled the picker and the visitor confirmed without changing it, else `"manual"`. Back does what `change()` does (clears the stored car, picker keyed afresh from that car) and then opens `chosenFrom`'s view. A car restored from the tab on load has no `chosenFrom`; its Back opens `manual`.

- [ ] **Step 1: Update and add failing component tests** in `vehicle.browser.test.tsx`:
  - Rename expectations: confirm button `Confirm this car`; R02 heading `Your car, confirmed`, `Continue to your details`, `Change car`.
  - `it("fills the Your car card as the picker is filled")`: pick Tesla → card shows `Tesla`; Model 3 → `Tesla Model 3`; 2024 and RWD → `Tesla Model 3 RWD` and `2024 · Electric · 4 doors`; change make → card back to the new make only.
  - `it("shows only the postcode on the registration screen")`.
  - `it("Change car or postcode clears the car and opens the registration screen, keeping the driver answers")`: seed a full journey; on R02 press `Change car or postcode`; `readJourney("car").vehicle` is undefined, `mainDriver` still set; the registration heading shows; its postcode `Change` link → `/quote?type=car&postcode=E8+3RL`.
  - `it("shows the details tabs with Car current and the rest locked")` on R01 with an empty journey.
  - `it("Back on R02 goes to where the car was chosen")`.
- [ ] **Step 2: Run** `vp test --project component src/features/quote/vehicle.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**: every view of `VehicleStep` renders inside `JourneyPage` with the `Car insurance / Your details` overline, the frame's heading and intro, `DetailsTabs`, and an aside of `CarCard` (live from `onChoiceChange` on R01, the confirmed car on R02, `null` on registration and not-found) and `HelpCard`. R01 wraps the picker in a card titled `Vehicle details` with the year label `Year first registered` and the dependency hint. `StepNav` on each view. The registration and not-found views keep their content, inside the frame (decision 2).
- [ ] **Step 4: Run** the vehicle tests. Expected: PASS.
- [ ] **Step 5: Update** `e2e/vehicle.spec.ts` for the renamed buttons and headings (no new E2E here).
- [ ] **Step 6: Commit** `feat(quote): the car step in the revamp: Choose your car, Your car confirmed, a live Your car card`.

### Task 4: The driver steps (R03–R08)

**Files:**
- Modify `src/features/quote/DriverSteps.tsx`, `AboutYouStep.tsx`, `LicenceStep.tsx`, `ClaimsStep.tsx`, `NamedDriversStep.tsx`, `step-kit.tsx`, `quote.css`, `drivers.browser.test.tsx`, `e2e/drivers.spec.ts`, `e2e/quote-journey.ts` if it matches on text.

**Interfaces:**
- **Consumes:** Task 2's parts; `tabStates`; `onStep` from the route (unchanged `Move` type).
- **Produces:** `DriverSteps` renders each step inside `JourneyPage` with `DetailsTabs` (tab `car` → `onStep(undefined)`, others → `onStep(tab)`), `CarCard` from `journey.vehicle` with `onChange` = clear the car and `onStep(undefined)`, and the step's `HelpCard` line. The step components keep their `StepProps` and validation; only their headings, intros, card grouping and button labels change.

- [ ] **Step 1: Update failing tests** in `drivers.browser.test.tsx`: each step's heading and intro per Global Constraints (with the car and name from the journey fixture); button labels `Continue to your licence`, `Continue to claims`, `Continue to named drivers`, `Get my car quote`; About you's `Home postcode: E8 3RL`. Add:
  - `it("ticks finished steps in the tabs and opens one when clicked")`: on Claims with About you and Driving done, click `About you, done` → About you with its answers.
  - `it("never links past the first unfinished step")`: on About you with an empty journey after the car, `Claims` and `Drivers` aren't buttons.
  - `it("drops the car clause from About you's intro without a car's model")`: not reachable through the UI (a car is required), so test the intro helper: `aboutIntro(undefined)` → `We’ll use this information to build your quote.`
- [ ] **Step 2: Run** `vp test --project component src/features/quote/drivers.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**: intros built by small pure helpers in `step-kit.tsx` (`aboutIntro(vehicle?)`, `licenceIntro(main?, vehicle?)`, `namedIntro(vehicle?)`) per call 13; About you splits into `About you` and `Home address` cards; Licence into `Your driving licence` and `How you use your car`; `StepNav` with the named primary button replaces each step's Back/Continue row.
- [ ] **Step 4: Run** the driver tests. Expected: PASS, including every 5.3 order and edit test unchanged in substance.
- [ ] **Step 5: Update** `e2e/drivers.spec.ts` for the new labels.
- [ ] **Step 6: Commit** `feat(quote): the driver steps in the revamp, with tabs, cards and named buttons`.

### Task 5: Your quote is ready (R09)

**Files:**
- Create `src/features/quote/PayChoice.tsx`.
- Modify `QuoteHolding.tsx`, `QuotePrice.tsx`, `DriverSteps.tsx` (Back to your details, Choose cover), `quote.css`, `drivers.browser.test.tsx`.

**Interfaces:**
- **Consumes:** `setPayment`, `Journey.payment` (Task 2); `CarPriceResult` (unchanged).
- **Produces:**
  - `PayChoice({ annualPence: number, monthlyPaymentPence: number, value: "annual" | "monthly", onChange })`: one `RadioGroup` with legend `Choose how you’d like to pay`, two large radio cards. Monthly's total payable is `monthlyPaymentPence * 12`, formatted with `formatPounds`.
  - `QuoteHolding` gains `onChooseCover: () => void`; the route's handler shows the holding line `Choosing your cover arrives in 5.5` until 5.5 (a `role="status"` line under the button).
  - `QuotePrice`'s quoted branch renders `Your Comprehensive price`, `PayChoice`, the IPT note and the `Choose cover` button; its referred/declined branches with **no** named driver keep the 5.4 lines; a named driver referred/declined branch is replaced by Task 6.

- [ ] **Step 1: Update the failing tests** under "the price on the holding view": with `QUOTED = { annualPence: 106_378, monthlyPaymentPence: 9_751 }`:
  - `it("shows annual and monthly as a choice, annual first")`: radio `Pay annually` checked; `£1,063.78` and `/year`; `Total payable £1,063.78`; `£97.51` `/month`; `Total payable £1,170.12` (9,751 × 12 = 117,012).
  - `it("keeps the pay choice through a refresh")`: pick monthly; `readJourney("car").payment === "monthly"`; remount → monthly checked.
  - `it("says Choose cover arrives in 5.5")`.
  - `it("goes back to Named drivers from Back to your details")`.
  - The existing "keeps one live region" test still passes.
- [ ] **Step 2: Run** the driver component tests. Expected: FAIL.
- [ ] **Step 3: Implement** R09 in `JourneyPage` (overline `Car insurance / Your quote`, no tabs, `CarCard` and `HelpCard title="Need a hand?"`), the price card, `Your details at a glance` (5.3's rows and Edit buttons, moved into a card), and the Back link.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): Your quote is ready, with pay annually or monthly and the total payable`.

### Task 6: Let's review your named driver (R10)

**Files:**
- Create `src/features/quote/DriverReview.tsx`.
- Modify `QuotePrice.tsx`, `QuoteHolding.tsx`, `drivers.browser.test.tsx`, `e2e/drivers.spec.ts`.

**Interfaces:**
- **Consumes:** `CarPriceResult` with `namedDriver`; `QuotePrice`'s `remove`/`undo` and `removed` state (5.4).
- **Produces:** `DriverReview({ name: string, outcome: "referred" | "declined", onRemove: () => void, onReview: () => void })`. `QuoteHolding` decides the view: a referred/declined result with a named driver → R10's heading and `DriverReview`; anything else → R09. The page heading, intro and overline change with the view (heading focus moves to the new `h1` when the view changes, as step changes do). The `removed` line (`{name} has been removed from this quote. Add {name} back`) shows above whichever view follows.

- [ ] **Step 1: Write failing tests** (replace 5.4's inline named-driver tests):
  - `it("shows the review step when a named driver is declined")`: h1 `Let’s review your named driver`, the declined intro and warning naming Sam, no price.
  - `it("uses the referral wording when a named driver needs checking")`.
  - `it("removes the driver and shows the price, with Add back")`: press `Remove Sam and see my price` → h1 `Your quote is ready`, the price, `Sam has been removed from this quote.`; `readJourney("car").namedDrivers.any === false` when Sam was the only one.
  - `it("Add back returns to the review step with the driver exactly as entered")`.
  - `it("shows the review for the next driver who stops the quote, keeping Add back for the last one removed")`: two drivers, both declined; remove the first → R10 for the second with `Add {first} back` above.
  - `it("opens Named drivers from Review named driver details")`.
  - `it("fits a long name at 360 px")`: set viewport 360; `document.documentElement.scrollWidth <= 360`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `DriverReview` (warning in the existing `Alert` tone `warning`; primary full-width accent button, secondary full-width) and the view switch.
- [ ] **Step 4: Run** the driver component tests. Expected: PASS.
- [ ] **Step 5: Update** `e2e/drivers.spec.ts`'s Tesla test: R10 names the driver; `Remove … and see my price` shows the price; `Add … back` returns to R10.
- [ ] **Step 6: Commit** `feat(quote): a review step for a named driver who stops the quote`.

### Task 7: Responsive pass, E2E, axe, docs and the full check

**Files:**
- Modify `quote.css`, `e2e/a11y.spec.ts`, `e2e/quote.spec.ts`, `plan/figma.md`, `plan/phases/05-quote/phase.md`, `plan/build-plan.md`, `plan/phases/05-quote/04b-journey-revamp.md`.

- [ ] **Step 1: Add** to `e2e/a11y.spec.ts`: axe at 360, 768 and 1280 px on `/quote`, `/quote/car` (registration), the picker (`vehicle=manual`), each `step` and R10 (journey from `quote-journey.ts` with the Tesla and a 19-year-old named driver). Add to `e2e/quote.spec.ts`: `it("has no horizontal scroll at 360 px on any car view")` and the existing no-JS start-form test run inside the new frame.
- [ ] **Step 2: Fix** whatever axe or the overflow test finds (colour contrast on the tinted card, tab names, landmark duplicates: the frame must have exactly one `main` and one `banner`).
- [ ] **Step 3: Docs:**
  - `figma.md`: a "Revamp, Web (`249:5806`)" section listing R01–R10 with nodes and the slice `5.4b`; mark screens 09, 11, 12, 12a and `157:10429` "replaced by the Revamp (5.4b)".
  - `phase.md`: add the 5.4b row after 5.4 (status `done (#NN)` at merge); under "Decisions before the phase", add to the Header bullet: "Replaced on 12 Nov 2026: the quote pages have their own journey frame (5.4b, decision 4)."
  - `build-plan.md`: `- [x] 5.4b **Journey revamp**: the car journey in the Revamp frames, journey header and footer, details tabs, Your car card, pay annually or monthly, named-driver review`.
  - The spec's Status to `done (merged as #NN)`, Done-when boxes ticked with the counts.
- [ ] **Step 4: Run the full check** (port 3000 first): `vp check`, `vp test`, `vp build`. Expected: all pass; record the file and test counts in the spec's Done when.
- [ ] **Step 5: Commit** `test(quote): axe and overflow across the revamped journey; docs for 5.4b`.
- [ ] **Step 6: Open the PR** into `staging` per `plan/git-workflow.md` (template: Slice, Done when, Preview, Checks; both trailers in the body). The manual check (spec Tests, last row) is Damion's on the preview; the PR isn't ready to merge until its results are recorded in the spec.
