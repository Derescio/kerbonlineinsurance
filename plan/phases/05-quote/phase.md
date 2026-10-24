# Phase 5: Quote

**Tag:** `s5-quote` · **Status:** todo

## Goal

The full quote journey from Figma, saved to the database, priced by a tested `priceQuote()`, ending in a real policy.

## Payoff shot

Complete a quote on a phone-width browser, pay (fake), land on 'You're covered', then show the policy row in Neon.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 5.1 | Flow shell + Stepper. **Perf:** TanStack Query `staleTime` per data type; intent preloading on links | todo |
| 5.2 | Vehicle step: make → model → year → variant from the catalogue; plate lookup faked against demo plates; postcode checked with postcodes.io. **Perf:** catalogue API long public cache; postcode results stored in `postcode_areas` | todo |
| 5.3 | Driving habits + driver steps with Zod validation | todo |
| 5.4 | Rating engine `priceQuote()`: base rate × rating factors + fees + IPT, bundle discount; reads versioned rating tables; stores breakdown + version on the quote; Vitest tests for all three products. **Perf:** rating tables read from the in-memory cache by version | todo |
| 5.5 | Cover options + quote summary: cover comparison table next to the CoverageOption cards (Admiral-style), and a price breakdown from `priceQuote()` | todo |
| 5.6 | Pay → policy saved; guests sign up or sign in first, quote kept; "Retrieve my quote" lists a signed-in user's saved quotes. **Integrity:** pay runs in one transaction (policy + bundle + audit) with an idempotency key, so a double-click can't create two policies; quote saves are rate-limited | todo |

## Recording notes

- Sources: Figma `Quote & Policy – Web/Mobile/Tablet` frames, `../ui_kits/web/QuoteSteps.jsx`, `../components/insurance/CoverageOption.jsx`.
- Show `vp test` running the pricing tests in watch mode: good Vitest-in-Vite+ moment.

## Exit criteria

- Quote completes end to end on the deployed URL.
- Pricing tests pass.
- Deployed and tagged.
