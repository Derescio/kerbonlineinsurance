# 5.1 Quote start: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/quote` becomes a real page: a type picker and a postcode, either filled from the link, that continue to the car or home journey shell (Stepper + slot) or to a "coming soon" page, with and without JavaScript, and a `quote.started` funnel event per journey.

**Architecture:** There are four layers.
1. **Pure rules** in `src/features/quote/`: the search parsers, `checkStart` (where Continue goes, or which errors), and the `sessionStorage` journey store.
2. **Routes** under `src/routes/_site/quote*.tsx`: `validateSearch` with those parsers, and `beforeLoad` redirects (the no-JS `next=1` submit, and a shell without a postcode).
3. **Components:** `QuoteStart` (with `TypePicker`), `ComingSoon` and `JourneyShell`. Plain GET forms and links that TanStack Router upgrades when JavaScript runs.
4. **Server:** `recordQuoteStart` (rate limit, then one insert, deduplicated by journey) behind the `startQuote` server function.

**Tech Stack:** TanStack Start / Router 1.170 (`validateSearch`, `beforeLoad`, `redirect`, `createServerFn`), React 19, Zod 4, Drizzle on `pg`, the 4.5c `limit()`, Vitest `unit` / `integration` / `component` projects, Playwright with axe.

**Spec:** [01-quote-start.md](01-quote-start.md). Read decisions 1–4 and calls 5–13 before starting.

## Global Constraints

- **Routes:** `/quote`, `/quote/coming-soon`, `/quote/car`, `/quote/home`. Search keys `type`, `postcode`, and `next` (the no-JS submit, value `1`).
- **Validation:** `postcodeSchema` / `normalisePostcode` (`src/features/quote/postcode.ts`) and `isProductId` (`products.ts`). A bad or missing value in a link is dropped, never shown as an error.
- **Picker order and badges:** Car, Home, Landlord, Pet, Condo, Business, Tenant. Car and Home "Available now", the rest "Coming soon".
- **Button:** "Continue with car", "Continue with home", otherwise "Continue".
- **Copy:** postcode error `Enter your full postcode, like E8 3RL.` (`postcodeError`); type error `Choose what you'd like to insure.`; link hint `Added from your link. You can change it here.`; slot `This step arrives in 5.2` (car) / `This step arrives in 5.7` (home). The rest of screens 01 and 02 as drawn.
- **Stepper:** `Your details · Your quote · Choose cover · Buy`, step 1 current, `label="Quote progress"`; `default` above 640px, `bar` at or below.
- **Storage:** `sessionStorage` keys `kerb.quote.v1.car` and `kerb.quote.v1.home`. Unavailable storage never throws and shows nothing.
- **`quote.started`:** product, postcode district (`E8`), `anonymous_id` only with consent. Limit 30 per IP per hour (`{ max: 30, windowSeconds: 3600 }`, key `quote.started:<subject>`). Once per journey.
- **Retrieve:** "Retrieve a saved quote" on screen 01, "Continue a saved quote" on the landing; both `/quote/retrieve`, plain `<a>` (no route yet).
- **Process:** stage files by name. No `vp build` or component tests while Damion's `vp dev` is running.

## Calls this plan makes (for Damion to check)

- **P1. A journey id, so a repeat writes nothing.** The browser makes a random UUID when a journey starts and keeps it in the tab's journey object. `quote.started` stores it as `entity_type = 'quote_journey'`, `entity_id = <uuid>`. A partial unique index (migration 0018) on `entity_id` where `name = 'quote.started'` makes a second insert a no-op, even from two tabs racing. That's one column the spec's "nothing else" didn't name. It's random and holds no personal data, and the alternative (no server dedupe) can't pass the spec's "second call writes nothing" test.
- **P2. The browser sends the district, not the postcode.** `startQuote` takes `{ product, district, journeyId, anonymousId }`, and the server checks the district's format. The full postcode never reaches the server in 5.1.
- **P3. `publicMiddleware`.** A guest server function needs no session lookup, so a new middleware in `src/server/auth/middleware.ts` gives `startQuote` the same error handling (fixed sentence, safe log) without `getActor`.
- **P4. Without JavaScript, no `quote.started`.** The event is sent from the shell after hydration (the spec's "once per tab" lives in `sessionStorage`). PostHog doesn't count those visitors either.
- **P5. A failed submit shows what was typed.** After a `next=1` submit with a bad postcode, the field keeps the typed value next to the error, so it can be fixed. Only link values are dropped.
- **P6. Coming soon lists all five types,** as drawn, and the chosen one's chip is marked selected. A `type` that's car, home or unknown redirects to `/quote` with the same search.
- **P7. Changing the postcode keeps the journey.** If the journey object already exists for that product, its postcode is updated, and the id and start time are kept.
- **P8. The "Change" link.** The shell shows the postcode with a "Change" link to `/quote?type=<product>&postcode=<postcode>`. Coming soon's "Back to all insurance types" goes to `/quote` with the postcode kept.
- **P9. Both Stepper variants are rendered,** and CSS shows one per width. That works without JavaScript and doesn't shift the layout. A hidden copy (`display: none`) is out of the accessibility tree.

## Review Focus

1. **A postcode that the default search parser turns into a number** (`?postcode=123`) or an array (`?postcode=a&postcode=b`). It must be dropped, not crash. Test in Task 1.
2. **Storage that throws on read *and* on write** (Safari private mode, a full quota). The shell still renders and still sends `quote.started` once per page. Test in Task 2.
3. **Two quick Continue clicks, or a refresh while the event is in flight.** One row only, by P1. Test in Task 3 (`Promise.all` of two calls).
4. **`/quote/coming-soon?type=car&postcode=E8+3RL`** (a hand-edited link). It goes to `/quote?type=car&postcode=E8 3RL`, never shows "car is coming soon". Test in Task 1 (`comingSoonRedirect`).
5. **The browser back button from `/quote/car` to `/quote`.** The picker shows the choice and the postcode again from the URL, with no `next=1` loop. Continue writes no `next` into the URL with JS, so back can't re-redirect. Test in Task 7 (E2E).

---

## File structure

| File | Responsibility |
|---|---|
| `src/features/quote/products.ts` (+ test) | adds `BuyableProductId`, `isBuyable`, `quoteTypes` (screen order, labels) |
| `src/features/quote/postcode.ts` (+ test) | adds `postcodeDistrict` |
| `src/features/quote/search.ts` (+ test) | `startSearch`, `journeySearch`, `comingSoonSearch`, `checkStart`, `comingSoonRedirect`, `typeError` |
| `src/features/quote/journey-store.ts` (+ test) | the `sessionStorage` journey object |
| `src/features/quote/QuoteStart.tsx`, `TypePicker.tsx`, `ComingSoon.tsx`, `JourneyShell.tsx`, `quote.css` | screens 01, 02 and the shell |
| `src/features/quote/quote.browser.test.tsx` | component tests |
| `src/features/quote/server.ts` | `startQuote` server function |
| `src/server/quote/start.ts` (+ `.int.test.ts`) | `recordQuoteStart`, `QUOTE_START_RULE` |
| `src/server/data/event-rows.ts` | `insertQuoteStarted` (raw insert, excluded from the permission scan like `job-rows.ts`) |
| `src/server/db/schema/data.ts`, `drizzle/0018_*.sql` | the partial unique index (P1) |
| `src/server/auth/middleware.ts` | `publicMiddleware` (P3) |
| `src/lib/analytics.ts` (+ test) | `anonymousId()` |
| `src/routes/_site/quote.tsx`, `quote.index.tsx`, `quote.coming-soon.tsx`, `quote.car.tsx`, `quote.home.tsx` | routes |
| `src/features/landing/Hero.tsx`, `ButtonLink.tsx`, `InsuranceTypes.tsx`, `HowItWorks.tsx`, `ClosingCta.tsx`, `src/components/site/links.ts` | router navigation and `<Link>`s |
| `e2e/quote.spec.ts`, `e2e/a11y.spec.ts`, `e2e/smoke.spec.ts` | E2E |

---

### Task 1: Search rules

**Files:** Modify `src/features/quote/products.ts`, `postcode.ts` and their tests. Create `src/features/quote/search.ts`, `search.test.ts`.

**Interfaces (Produces):**
- `type BuyableProductId = "car" | "home"`; `buyableProducts: readonly BuyableProductId[]`; `isBuyable(id: ProductId): id is BuyableProductId`
- `quoteTypes: readonly { id: ProductId; label: string }[]`, in screen order (`label` is "Car", "Home", …)
- `postcodeDistrict(postcode: string): string` (the outward code of a normalised postcode)
- `interface StartSearch { type?: ProductId; postcode?: string; next?: 1 }`; `startSearch(raw: Record<string, unknown>): StartSearch`. Without `next`, `postcode` is normalised or dropped. With `next`, it's the raw typed string (P5).
- `journeySearch(raw): { postcode?: string }` and `comingSoonSearch(raw): { type?: ProductId; postcode?: string }`, both normalised or dropped.
- `typeError = "Choose what you'd like to insure."`
- `checkStart(input: { type?: ProductId; postcode?: string }): { ok: true; to: "/quote/car" | "/quote/home" | "/quote/coming-soon"; search: { type?: ProductId; postcode?: string } } | { ok: false; errors: { type?: string; postcode?: string } }`
- `comingSoonRedirect(search): { type?: ProductId; postcode?: string } | null`. Non-null means "send to `/quote` with this search".

- [ ] **Step 1: Write the failing tests** (`search.test.ts`, plus additions to the two existing tests):
  - `startSearch({ postcode: "e83rl" })` → `{ postcode: "E8 3RL" }`; `{ postcode: "E8" }`, `{ postcode: 123 }`, `{ postcode: ["E8 3RL","N1 9GU"] }`, `{ type: "van" }` → `{}`; `{ type: "home", postcode: "nope", next: 1 }` → `{ type: "home", postcode: "nope", next: 1 }`; `next: "1"` is also accepted; any other `next` is dropped.
  - `checkStart({ type: "car", postcode: "e8 3rl" })` → `{ ok: true, to: "/quote/car", search: { postcode: "E8 3RL" } }`; home likewise.
  - `checkStart({ type: "pet" })` → coming soon with `search: { type: "pet" }`; `{ type: "pet", postcode: "E83RL" }` keeps `postcode: "E8 3RL"`; `{ type: "pet", postcode: "bad" }` → `errors.postcode === postcodeError`.
  - `checkStart({ type: "car" })` and `{ type: "car", postcode: "E8" }` → `errors: { postcode: postcodeError }`; `checkStart({})` → `errors: { type: typeError, postcode: undefined }` (the postcode is only required once a buyable type is known); `checkStart({ postcode: "E8" })` → both errors.
  - `comingSoonRedirect({ type: "car", postcode: "E8 3RL" })` → `{ type: "car", postcode: "E8 3RL" }`; `{}` → `{}`; `{ type: "landlord" }` → `null`.
  - `quoteTypes.map(t => t.id)` equals the screen order, and contains every `productIds` entry once; `postcodeDistrict("E8 3RL") === "E8"`, `"SW1A 1AA" → "SW1A"`.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement.** `quoteHrefFor` goes (Task 6 replaces its callers with `<Link search>`); remove its test. Number values become strings before normalising; anything that's not a string or number is dropped.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): search rules for the quote start`.

### Task 2: The journey store

**Files:** Create `src/features/quote/journey-store.ts`, `journey-store.test.ts`.

**Interfaces (Produces):**
- `interface Journey { version: 1; journeyId: string; postcode: string; startedAt: string; startRecorded: boolean }`
- `journeyKey(product: BuyableProductId): string` → `kerb.quote.v1.<product>`
- `type JourneyStorage = Pick<Storage, "getItem" | "setItem">`; `sessionStore(): JourneyStorage | null` (try/catch around `window.sessionStorage`)
- `readJourney(product, storage = sessionStore()): Journey | null`
- `beginJourney(product, postcode, now = new Date(), storage = sessionStore()): Journey` (P7; always returns a journey, written if it can be)
- `markStartRecorded(product, storage = sessionStore()): void`

- [ ] **Step 1: Write the failing tests** with an in-memory `Map` storage:
  - `beginJourney("car", "E8 3RL", now)` then `readJourney("car")` round-trips: `version 1`, a UUID `journeyId`, `startedAt === now.toISOString()`, `startRecorded false`.
  - Calling it again with "N1 9GU" keeps `journeyId` and `startedAt`, and updates `postcode`; car and home don't share a key.
  - `readJourney` returns null for `"{"`, for `{ version: 0, … }` and for a missing field.
  - A storage whose `getItem` and `setItem` both throw: `beginJourney` returns a journey, and `readJourney` returns null; `sessionStore()` returns null when the `window.sessionStorage` getter throws (stub with `vi.stubGlobal`).
  - `markStartRecorded` then `readJourney(...).startRecorded === true`.
- [ ] **Step 2: Run** `vp test --project unit src/features/quote/journey-store`. Expected: FAIL.
- [ ] **Step 3: Implement** with a Zod `z.object({ version: z.literal(1), journeyId: z.uuid(), postcode: z.string(), startedAt: z.iso.datetime(), startRecorded: z.boolean() })`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): the journey object in sessionStorage`.

### Task 3: `quote.started` on the server

**Files:**
- Modify: `src/server/db/schema/data.ts` (index), `src/server/auth/middleware.ts`, `src/server/data/permissions.int.test.ts` (exclude `event-rows.ts`, with a comment).
- Create: `drizzle/0018_*.sql` (via `vp run db:generate`), `src/server/data/event-rows.ts`, `src/server/quote/start.ts`, `src/server/quote/start.int.test.ts`, `src/features/quote/server.ts`.

**Interfaces (Produces):**
- `insertQuoteStarted(row: { product: BuyableProductId; district: string; journeyId: string; anonymousId: string | null }, db: Db = getDb()): Promise<boolean>`: true if a row was written. Insert with `onConflictDoNothing()`, `properties: { product, district }`.
- `QUOTE_START_RULE = { max: 30, windowSeconds: 3600 }`
- `startQuoteInput`: Zod `{ product: z.enum(["car","home"]), district: z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]?$/), journeyId: z.uuid(), anonymousId: z.string().min(1).max(200).nullable() }`; `type StartQuoteInput`
- `recordQuoteStart(raw: unknown, headers: Headers, secret?: string): Promise<{ recorded: boolean }>`: parse (bad input gives `{ recorded: false }` and writes nothing), then `limit("quote.started:" + await rateLimitSubject(null, headers, secret), QUOTE_START_RULE)` (throws `RateLimitError`), then insert.
- `publicMiddleware`: like `actorMiddleware` but with no `getActor` and no context.
- `startQuote` (`src/features/quote/server.ts`): `createServerFn({ method: "POST" }).middleware([publicMiddleware]).validator((input: StartQuoteInput) => input)`. The handler imports `#/server/quote/start` inside and passes `getRequestHeaders()`.

- [ ] **Step 1: Write the failing integration tests** (`start.int.test.ts`; `truncateAll` in `beforeEach`, headers `x-forwarded-for: 203.0.113.7`, `SECRET` from `#/test/auth`):
  - One call writes exactly one `events` row: `name 'quote.started'`, `entityType 'quote_journey'`, `entityId` the journey id, `anonymousId` as sent, `userId null`, `properties` deep-equals `{ product: "car", district: "E8" }`.
  - `anonymousId: null` is stored as null.
  - The same `journeyId` twice, sequentially and with `Promise.all`: one row, and the second result is `{ recorded: false }`.
  - 30 calls with different journey ids from one IP succeed, and the 31st rejects with `RateLimitError` (silence `console.warn`); a different IP still succeeds.
  - Bad input (`district: "E8 3RL"`, `product: "pet"`, `journeyId: "x"`) → `{ recorded: false }` and no row.
- [ ] **Step 2: Run** `vp run db:test:up`, then `vp test --project integration src/server/quote`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `uniqueIndex("events_quote_started_journey").on(t.entityId).where(sql\`${t.name} = 'quote.started'\`)` to `events`, then run `vp run db:generate` and give the SQL a header comment like the other migrations. `vp test --project unit src/server/db/data-contract` still passes (no column change).
- [ ] **Step 4: Run** the integration tests, plus `src/server/data/permissions.int.test.ts` and `src/server/db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): record quote.started once per journey, rate-limited`.

### Task 4: The type picker and quote start (screen 01)

**Files:** Create `src/features/quote/TypePicker.tsx`, `QuoteStart.tsx`, `quote.css`, `quote.browser.test.tsx`. Modify `src/styles.css` (import `quote.css`), `src/components/site/links.ts` (comment: `/quote` is a route now).

**Interfaces:**
- Consumes: Task 1 (`quoteTypes`, `isBuyable`, `checkStart`, `StartSearch`, `typeError`), `RadioGroup`, `Radio`, `Badge`, `Input`, `Button`, `retrieveQuoteLink.href`.
- Produces: `TypePicker({ value, onChange, error }: { value?: ProductId; onChange(id: ProductId): void; error?: string })`, with radios named `type`. `QuoteStart({ search }: { search: StartSearch })`.

Behaviour:
- **The form:** `<form method="get" action="/quote" noValidate>` with a hidden `next=1`. On submit with JS: `preventDefault`, then `checkStart`. On `ok`, navigate to `{ to, search }`. Otherwise show the errors and focus the first invalid field: the checked radio, or the first one, for type; the input for postcode.
- **Server-rendered errors:** when `search.next` is set, `checkStart(search)`'s errors render on first paint (the redirect case never reaches here).
- **The hint** shows while the field still holds the link's postcode and `!search.next`.
- **Below the field:** the line "We'll use your postcode to find your address and work out your quote." is a plain paragraph. The postcode label is "Your postcode", marked `optional` while a coming-soon type is picked.
- **Headings:** "Get a quote" overline, h1 "What would you like to insure?", intro as drawn, and the `RadioGroup` legend "What would you like to insure?" visually hidden (`.quote-types > legend` is sr-only), so the h1 isn't read twice as a different name.

- [ ] **Step 1: Write the failing component tests** (`renderWithRouter(<QuoteStart search={…} />, "/quote")`):
  - Seven radios named Car, Home, Landlord, Pet, Condo, Business, Tenant in that order. Car and Home are described by "Available now", the rest by "Coming soon".
  - `search={{ type: "home" }}`: Home is checked and the button reads "Continue with home". ArrowRight checks Landlord and the button reads "Continue"; nothing picked reads "Continue".
  - `search={{ postcode: "E8 3RL" }}`: the field shows "E8 3RL", with the description "Added from your link. You can change it here.". After typing a change, the hint is gone. `search={{}}` has no hint.
  - Car plus "E8" then Continue: `postcodeError` on the field, focused, and the router is still on `/quote`. Car plus "e83rl": `router.state.location` is `/quote/car` with `search.postcode === "E8 3RL"`.
  - Pet with an empty postcode then Continue → `/quote/coming-soon`, `search.type === "pet"`. Nothing picked → `typeError` as the group's description.
  - `search={{ type: "car", postcode: "zz", next: 1 }}` renders the error on first paint, and the field shows "zz".
  - "Retrieve a saved quote" links to `/quote/retrieve`.
- [ ] **Step 2: Run** `vp test --project component src/features/quote`. Expected: FAIL.
- [ ] **Step 3: Implement.** Cards are `Radio` with the label and `description={<Badge tone={buyable ? "success" : "neutral"}>…</Badge>}` and a card class. Grid: 4 columns from 1024px, 2 from 480px, 1 below. The checked card gets the screen's tint and border (`:has(input:checked)`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): quote start with the type picker and postcode`.

### Task 5: Coming soon and the journey shell

**Files:** Create `src/features/quote/ComingSoon.tsx`, `JourneyShell.tsx`. Modify `src/lib/analytics.ts` (+ `analytics.test.ts`), `quote.css`, `quote.browser.test.tsx`.

**Interfaces:**
- Consumes: Tasks 1–3, `Stepper`, `Card`, `Tag`, `Link`.
- Produces: `ComingSoon({ search }: { search: { type?: ProductId; postcode?: string } })`; `JourneyShell({ product, postcode }: { product: BuyableProductId; postcode: string })`; `JOURNEY_STEPS`; `anonymousId(): string | null` in analytics.ts (the client's `get_distinct_id()` only when consent is `"granted"`; add `get_distinct_id` to `Client`).

Behaviour:
- **ComingSoon:** screen 02's copy. Chips for the five coming-soon types, in `quoteTypes` order, with the chosen one `selected` (P6).
- **The two offers:** "Get a car quote" / "Get a home quote" go to `/quote/car|home?postcode=` when there's a postcode, else to `/quote?type=car|home`.
- **The rest of the page:** "Back to all insurance types" (P8), and the postcode line "Your postcode, E8 3RL, will be kept if you choose car or home." only with a postcode.
- **JourneyShell:** both Stepper variants (P9); an overline "Car quote" / "Home quote", h1 "Your details", "Postcode: E8 3RL" with a "Change" link (P8), and the slot card with the 5.2 / 5.7 line.
- **The shell's effect:** in `useEffect`, `beginJourney`; unless `startRecorded`, call `startQuote({ data: { product, district: postcodeDistrict(postcode), journeyId, anonymousId: anonymousId() } })`, then `markStartRecorded` on `recorded: true` or `false` (a duplicate is done too). Errors are swallowed and never shown.

- [ ] **Step 1: Write the failing tests** (`vi.mock("./server", () => ({ startQuote: vi.fn().mockResolvedValue({ recorded: true }) }))`, `sessionStorage.clear()` in `beforeEach`):
  - ComingSoon with `{ type: "landlord", postcode: "E8 3RL" }`: "Get a car quote" href `/quote/car?postcode=E8%203RL` (or `+`; assert via `new URL(href, location.origin).searchParams.get("postcode") === "E8 3RL"`), and the postcode line shows. Without a postcode, the car link has `type=car` and the line is absent.
  - JourneyShell car: a `navigation` named "Quote progress" with "Your details" `aria-current="step"`, the slot text "This step arrives in 5.2", and `startQuote` called once with `{ product: "car", district: "E8", journeyId: <uuid>, anonymousId: null }`. Unmount and mount again: still once, and `readJourney("car").startRecorded` is true.
  - `startQuote` rejecting: the shell still renders, nothing is shown, and no error is thrown.
  - `sessionStorage` throwing (`vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw … })`): the shell renders and `startQuote` is called.
  - Unit (`analytics.test.ts`): `anonymousId()` is null with no client, null when consent is pending, and the distinct id when granted.
- [ ] **Step 2: Run** the component and unit tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The `bar` Stepper is hidden above 640px and the `default` one at or below, both with `display: none`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): coming soon and the car and home journey shells`.

### Task 6: Routes and the landing's links

**Files:**
- Create: `src/routes/_site/quote.tsx` (an `<Outlet />` in a `site-container quote` wrapper), `quote.index.tsx`, `quote.coming-soon.tsx`, `quote.car.tsx`, `quote.home.tsx`. `routeTree.gen.ts` regenerates.
- Modify: `Hero.tsx`, `ButtonLink.tsx`, `InsuranceTypes.tsx`, `HowItWorks.tsx`, `ClosingCta.tsx`, `links.ts`, and `hero.browser.test.tsx`, `hero-experiment.browser.test.tsx`, `landing-parts.browser.test.tsx` (render with `renderWithRouter`).

**Interfaces:**
- **`/quote`:** `validateSearch: startSearch`; `beforeLoad({ search })` throws `redirect({ to, search })` when `search.next` and `checkStart` is ok. The component reads `Route.useSearch()` and renders `<QuoteStart key={…} search={search} />`, keyed on the search so a back navigation resets the state.
- **`/quote/coming-soon`:** `validateSearch: comingSoonSearch`; `beforeLoad` redirects to `/quote` when `comingSoonRedirect` is non-null.
- **`/quote/car|home`:** `validateSearch: journeySearch`; with no postcode, `beforeLoad` redirects to `/quote` with `search: { type: product }`.
- **Titles:** `head` gives "Get a quote · Kerb", "Coming soon · Kerb", "Car quote · Kerb", "Home quote · Kerb".
- **`ButtonLink`:** takes `search?: { type?: ProductId }` in place of `href` and renders TanStack `<Link to="/quote" search>` with the same classes.
- **`Hero`:** for a valid postcode, `e.preventDefault()`, `track("quote_started", …)` unchanged, then `navigate({ to: "/quote", search: { postcode } })`. The form keeps `method="get" action="/quote"` for no-JS.

- [ ] **Step 1: Update the landing tests.** Hero: a valid postcode leaves the router at `/quote` with `search.postcode === "E8 3RL"`, and an invalid one leaves it at `/`. Landing parts: "Get a car insurance quote" has href `/quote?type=car`, and "How it works" and the closing CTA have href `/quote`.
- [ ] **Step 2: Run** `vp test --project component src/features/landing`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the landing changes, then run `vp run generate-routes`.
- [ ] **Step 4: Run** `vp check` and `vp test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): quote routes, and the landing's quote links inside the app`.

### Task 7: E2E and docs

**Files:** Create `e2e/quote.spec.ts`. Modify `e2e/a11y.spec.ts`, `e2e/smoke.spec.ts`, `plan/engineering.md` §13, and the spec's Status line.

- [ ] **Step 1: Write `e2e/quote.spec.ts`:**
  - **Hero:** "e83rl" → `/quote` with the postcode field "E8 3RL" and the hint → pick Car → Continue → `/quote/car`, with "Your details" current in "Quote progress". Back → `/quote` with Car checked (Review Focus 5). Forward, then reload: still `/quote/car` with "Postcode: E8 3RL".
  - **Coming soon:** `/quote?type=landlord` → type E8 3RL → Continue → coming soon → "Get a car quote" → `/quote/car` with E8 3RL.
  - **Without JavaScript** (`test.use({ javaScriptEnabled: false })` in a `describe`): `/quote`, check Car, fill "e8 3rl", Continue → `/quote/car` showing E8 3RL; "E8" → `/quote?…next=1` with the error text visible.
  - **Bad links:** `/quote/car` with no postcode lands on `/quote?type=car`, and `/quote?postcode=nope&type=van` shows an empty field and nothing checked.
- [ ] **Step 2: Update the existing specs.** In `a11y.spec.ts` `pages`, add `/quote`, `/quote?type=car&postcode=E8+3RL`, `/quote/coming-soon?type=landlord&postcode=E8+3RL` and `/quote/car?postcode=E8+3RL`. In `smoke.spec.ts`, the hero test now expects the quote page's h1 "What would you like to insure?" instead of the 404, with the URL matching `/\/quote\?postcode=E8(\+|%20)3RL$/`. The `/quote?type=car` href check stays.
- [ ] **Step 3: Run locally.** Stop any `vp dev` first (ask Damion), then `vp build && vp preview`, and `BASE_URL=http://localhost:4173 vp exec playwright test e2e/quote.spec.ts e2e/a11y.spec.ts e2e/smoke.spec.ts`. Expected: PASS (the event POST fails quietly locally with no database, which is the point of swallowing it).
- [ ] **Step 4: Update the docs.** engineering.md §13 says `quote.started` is recorded from 5.1 (district only, deduplicated by `quote_journey`, limited 30/IP/hour). The spec's status is "approved, in build", with a link to this plan.
- [ ] **Step 5: Commit** `test(quote): E2E for the quote start, and docs`.

### Task 8: PR

- [ ] `vp check`, `vp test`, `vp build` all pass.
- [ ] **The done markers in the PR** ([git-workflow.md](../../git-workflow.md) step 2): spec Status "done (PR #N)", the phase.md row, and the build-plan.md box. The manual staging check stays open for Damion.
- [ ] Push, then `gh pr create --base staging` with the spec's commit message as the title and the template sections. Then check `ci`.
