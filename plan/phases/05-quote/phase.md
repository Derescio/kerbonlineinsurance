# Phase 5: Quote

**Tag:** `s5-quote` · **Status:** todo

## Goal

The full quote journey from Figma, for car and home, saved to the database, priced by a tested `priceQuote()`, ending in a real policy.

## Quote start (decided 31 Oct 2026)

`/quote` takes two inputs, and either can arrive first:

- **Hero:** `/quote?postcode=E8+3RL`. The postcode is filled in, and the user picks a type.
- **Insurance types accordion:** `/quote?type=landlord`. The type is picked, and the user enters a postcode.
- Both stay editable. Bad values in the URL are dropped quietly (the field shows empty), not shown as errors.
- The search params are validated with `postcodeSchema` (`src/features/quote/postcode.ts`) and `isProductId` (`src/features/quote/products.ts`), the same rules the landing already uses.
- The type picker lists all seven types. `buyableProducts` (car, home) continue into their steps; the rest show a "coming soon" panel that offers a car or home quote instead.

## Payoff shot

Complete a quote on a phone-width browser, pay (fake), land on 'You're covered', then show the policy row in Neon.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 5.1 | Quote start + flow shell + Stepper: `/quote` with the type picker and postcode field, prefilled from `?type` and `?postcode` (see Quote start); the hero's native submit becomes a router navigation. **Perf:** TanStack Query `staleTime` per data type; intent preloading on links | todo |
| 5.2 | Vehicle step: make → model → year → variant from the catalogue; plate lookup faked against demo plates; postcode checked with postcodes.io. **Perf:** catalogue API long public cache; postcode results stored in `postcode_areas` | todo |
| 5.3 | Driving habits + driver steps with Zod validation | todo |
| 5.4 | Rating engine `priceQuote()`: base rate × rating factors + fees + IPT, bundle discount; reads versioned rating tables; stores breakdown + version on the quote; Vitest tests for all three products. **Perf:** rating tables read from the in-memory cache by version | todo |
| 5.5 | Cover options + quote summary: cover comparison table next to the CoverageOption cards (Admiral-style), and a price breakdown from `priceQuote()` | todo |
| 5.6 | Pay → policy saved; guests sign up or sign in first, quote kept; "Retrieve my quote" lists a signed-in user's saved quotes. **Integrity:** pay runs in one transaction (policy + bundle + audit) with an idempotency key, so a double-click can't create two policies; quote saves are rate-limited. **E2E:** Playwright journey in `e2e.yml`: car quote → sign in → pay → policy shows on the dashboard | todo |
| 5.7 | Home steps: property (address from the postcode, type, age, rebuild cost) → contents and security → past claims, with Zod schemas, then the shared cover, summary and pay steps. Check the `Quote & Policy` Figma frames for home screens first; design them if they aren't there ([figma.md](../../figma.md)) | todo |

## Recording notes

- Sources: Figma `Quote & Policy – Web/Mobile/Tablet` frames, `../ui_kits/web/QuoteSteps.jsx`, `../components/insurance/CoverageOption.jsx`.
- Show `vp test` running the pricing tests in watch mode: good Vitest-in-Vite+ moment.

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). `src/features/rating` and `src/features/quote/schemas` have coverage thresholds.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Component | Quote start: each prefill combination (postcode only, type only, both, neither, bad values dropped); asks for whichever is missing; a coming-soon type can't continue and offers car or home | 5.1 | yes |
| Component | Stepper: back and next, can't move past an invalid step, answers kept when going back, progress announced to screen readers | 5.1 | yes |
| Component | Vehicle picker: make → model → year → variant cascade clears the children when a parent changes; demo plate fills the picker, an unknown plate shows the manual route | 5.2 | yes |
| Integration | Catalogue API sends a long public `Cache-Control`; a postcode is looked up once (postcodes.io mocked) and then read from `postcode_areas`; an invalid postcode gets a friendly error | 5.2 | yes |
| Unit | Step Zod schemas: driver age limits, licence date not before 17th birthday, claims history shape, UK postcode format | 5.3 | yes |
| Unit | `priceQuote()`, table-driven for car, home and business: base rate × factors, fees, IPT rounded to whole pence, bundle discount, breakdown lines sum to the total, unknown `rating_version` throws | 5.4 | yes |
| Integration | A saved quote stores its breakdown and `rating_version`; reading it after a new version still shows the old price | 5.4 | yes |
| Component | Cover cards and comparison table select the same option; price breakdown shows each line from `priceQuote()` | 5.5 | yes |
| Integration | Pay: a double submit with one idempotency key makes one policy; a failure part-way leaves no policy, bundle or audit row; quote saves hit the rate limit; a guest quote survives sign-in; "Retrieve my quote" lists only the user's own quotes | 5.6 | yes |
| E2E | Car quote → sign in → pay → policy on the dashboard, at phone width; axe on each quote step | 5.6 | yes |
| Unit | Home step Zod schemas: rebuild cost and contents value ranges, property age, claims history shape | 5.7 | yes |
| E2E | Accordion "Get a home insurance quote" → postcode → home steps → pay → policy on the dashboard; axe on each home step | 5.7 | yes |

## Exit criteria

- Car and home quotes both complete end to end on the deployed URL.
- Pricing tests pass.
- Pay idempotency and rollback integration tests pass.
- The car and home quote → policy Playwright journeys and the axe scans of each step pass on a preview.
- Deployed and tagged.
