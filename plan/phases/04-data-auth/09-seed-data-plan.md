# 4.9 Seed data: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vp run db:seed` fills Neon `dev` with a named cast and a year of synthetic customers, quotes, policies, claims and reviews, priced from the 4.8 v1 rating tables, in one transaction that a rerun leaves alone.

**Architecture:** There are three layers. (1) Pure generation: a seeded PRNG drives builders that turn a `SeedContext` (catalogue, rating sources and version ids, config) into a `SeedPlan`, plain row objects per table, with a stand-in pricer reading `RatingSource`. (2) A writer that takes a `SeedPlan` and a Drizzle owner connection and inserts it in foreign-key order inside one transaction, adding the auth rows (Better Auth password hash, encrypted TOTP) and the audit chain rows. (3) A thin `scripts/seed.ts` entry that loads `.env.local`, runs the guard, boots Vite's module runner (as `scripts/reference-data.ts` does) and prints counts.

**Tech Stack:** TypeScript, Drizzle (node-postgres), Vitest `unit` and `integration` projects, `better-auth/crypto` (`hashPassword`, `symmetricEncrypt`), `src/server/audit/chain.ts`.

**Spec:** [09-seed-data.md](09-seed-data.md). Read its calls 8–19 and the cast table before starting.

## Global Constraints

- `dev` only. Refuse unless `databaseHost(DATABASE_URL_UNPOOLED) === SEED_DATABASE_HOST`. Refuse whenever `VERCEL_TARGET_ENV` is set.
- Cast emails: `<local>+<suffix>@<domain>` from `SEED_INBOX`. Suffixes: `customer-a`, `customer-b`, `business`, `closure-settled`, `closure-held`, `handler`, `admin`. Crowd emails: `@kerb-synthetic.invalid`.
- Every seeded user has `is_synthetic = true` and `email_verified = true`, except crowd users closed and scrubbed (call 17), who take 4.7's scrubbed form: `closed+<id>@closed.invalid`, name "Closed account", `email_verified = false`, no `accounts` row.
- `SEED_PASSWORD` must be at least 10 characters. `SEED_TOTP_SECRET` must be 32 characters of `[A-Za-z0-9]`.
- History window: 1 Nov 2025 to 31 Oct 2026 (`SEED_FROM = 2025-11-01T00:00:00Z`, `SEED_TO = 2026-10-31T23:59:59Z`). PRNG seed constant `SEED = 4_9_2026`.
- Audit rows are stamped at run time through `nextCreatedAt`, never backdated. Actions used: `staff.added`, `claim.viewed`, `referral.viewed`, `account.closure_requested`, `account.closure_cancelled`, `account.closed` only.
- References: quotes `KRB-Q-9xxxx`, policies `KRB-9xxxxx`, claims `KRB-C-9xxxx`.
- Money is integer pence. Totals must satisfy `quotes_total_check`, `claim_settlements_payout_check` and the other 4.2 `CHECK`s. Don't disable constraints or triggers.
- `account_closures.closes_at = requested_at + 30 days` exactly (`CLOSURE_WINDOW_DAYS`).
- No new npm dependencies.
- Stage files by name, never a folder (Damion edits `plan/` alongside).

## Review Focus

1. **A rerun on a `dev` that already has synthetic users** must print "already seeded" with counts and write nothing, even after the closure walkthrough has scrubbed two cast users. The check is `exists (select 1 from users where is_synthetic)`, not a cast email. Test in Task 6.
2. **`dev` already has real rows**: Damion's admin (`H-001`), audit rows and security events. Staff codes continue from the max, and the audit chain extends the latest row. Test in Task 6: pre-insert a staff member and an audit row, seed, then `verifyAuditChain()` passes and the codes are unique.
3. **A failure halfway** leaves nothing behind: zero synthetic users and an unchanged audit row count. Test in Task 6, which injects a bad row.
4. **Reference data missing** (seed run before `db:reference`): fail with "Run vp run db:reference first", not a foreign-key error. Test in Task 6.
5. **Bad or missing env values** (short password, malformed TOTP secret, wrong host): fail with a named message before connecting. Tests in Task 1.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/seed/guard.ts` (+ `.test.ts`) | `readSeedConfig(env)`: validates the env and the target host, pure |
| `scripts/seed/random.ts` (+ `.test.ts`) | `Rng` (mulberry32), weighted picks, dates in a window, `uuidv7At` |
| `scripts/seed/names.ts` | first names, last names, street names, area weights, review texts |
| `scripts/seed/pricer.ts` (+ `.test.ts`) | stand-in pricer and eligibility over a `RatingSource` |
| `scripts/seed/types.ts` | `SeedContext`, `SeedPlan`, row types (`$inferInsert` of each table) |
| `scripts/seed/builders.ts` | one customer's records: quote → items → options/addons/factors → decisions → policy → payments → claims → events, reviews, notifications |
| `scripts/seed/cast.ts` | the seven cast members, built with the builders and fixed choices |
| `scripts/seed/crowd.ts` | `crowdSize` customers with the call 17 shape |
| `scripts/seed/generate.ts` (+ `.test.ts`) | `generateSeed(ctx)`: cast + crowd, merged into one `SeedPlan` |
| `scripts/seed/write.ts` (+ `.int.test.ts`) | `seedDatabase(db, opts)`: already-seeded check, load context, generate, insert, audit |
| `scripts/seed.ts` | entry point: env, guard, module runner, prints |
| `package.json` | `"db:seed": "node scripts/seed.ts"` |
| `.env.example` | the four `SEED_*` names (plus `SEED_BETTER_AUTH_SECRET`, optional) |
| `plan/engineering.md` §3 | the reseed steps (spec call 12) |
| `plan/phases/05-quote/phase.md` 5.4 row | note: replace the stand-in with `priceQuote()`, reseed `dev`; references below the 9 range |

`scripts/**` is already exempt from the data-layer lint rule and included in both Vitest projects. Code under `scripts/seed/` may import `#/…`, because the entry runs it through the module runner and Vitest resolves `tsconfigPaths`.

---

### Task 1: Config and guard

**Files:**
- Create: `scripts/seed/guard.ts`, `scripts/seed/guard.test.ts`
- Modify: `.env.example` (a "Seed (4.9)" block with names only: `SEED_INBOX`, `SEED_PASSWORD`, `SEED_TOTP_SECRET`, `SEED_DATABASE_HOST`, `SEED_BETTER_AUTH_SECRET` (optional, defaults to `BETTER_AUTH_SECRET`))

**Interfaces:**
- Produces:
  ```ts
  export interface SeedConfig {
    url: string;            // DATABASE_URL_UNPOOLED
    host: string;
    inbox: { local: string; domain: string };
    password: string;
    totpSecret: string;
    authSecret: string;     // SEED_BETTER_AUTH_SECRET ?? BETTER_AUTH_SECRET
  }
  export class SeedConfigError extends Error { readonly reason: SeedConfigReason }
  export type SeedConfigReason =
    | "in_vercel_build" | "no_url" | "bad_url" | "no_target_host" | "wrong_host"
    | "bad_inbox" | "short_password" | "bad_totp_secret" | "no_auth_secret";
  export function readSeedConfig(env: Record<string, string | undefined>): SeedConfig;
  export function castEmail(inbox: SeedConfig["inbox"], suffix: string): string; // lowercase
  ```

- [ ] **Step 1: Write the failing tests** in `guard.test.ts`, one `it` per reason. With a valid base env, each test removes or breaks one value and expects `SeedConfigError` with that `reason`:
  - `VERCEL_TARGET_ENV: "preview"` → `in_vercel_build`. This is checked first, before anything else.
  - Host `ep-prod.neon.tech` vs `SEED_DATABASE_HOST=ep-dev.neon.tech` → `wrong_host`.
  - `SEED_INBOX: "no-at-sign"` → `bad_inbox`.
  - `SEED_PASSWORD: "short"` → `short_password`.
  - `SEED_TOTP_SECRET` of 31 chars, or containing `-` → `bad_totp_secret`.
  - Valid env → `authSecret` falls back to `BETTER_AUTH_SECRET`, and `SEED_BETTER_AUTH_SECRET` wins when set.
  - `castEmail({local:"damionwilson",domain:"opsedsolutions.com"},"customer-a")` → `"damionwilson+customer-a@opsedsolutions.com"`.
  - The error message never contains the connection string. Assert `!message.includes("postgres://")` for `bad_url`.
- [ ] **Step 2:** `vp test --project unit scripts/seed/guard.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `readSeedConfig` and `castEmail`. Use `databaseHost()` from `scripts/database-host.ts`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `git add scripts/seed/guard.ts scripts/seed/guard.test.ts .env.example` then `git commit -m "feat: seed config and dev-only guard"`.

---

### Task 2: Random, ids and names

**Files:**
- Create: `scripts/seed/random.ts`, `scripts/seed/random.test.ts`, `scripts/seed/names.ts`

**Interfaces:**
- Produces:
  ```ts
  export class Rng {
    constructor(seed: number);
    next(): number;                               // [0, 1)
    int(min: number, max: number): number;        // inclusive
    chance(p: number): boolean;
    pick<T>(items: readonly T[]): T;
    weighted<T>(items: readonly (readonly [T, number])[]): T;
    dateBetween(from: Date, to: Date): Date;
    fork(label: string): Rng;                     // independent stream per customer, stable under reordering
  }
  export function uuidv7At(at: Date, rng: Rng): string;  // RFC 9562 v7: 48-bit ms timestamp, version 7, variant 10, rest from rng
  export const SEED = 4_9_2026;
  export const SEED_FROM: Date; export const SEED_TO: Date;
  // names.ts
  export const FIRST_NAMES: readonly string[];   // ~60
  export const LAST_NAMES: readonly string[];    // ~80
  export const STREET_NAMES: readonly string[];  // ~40, e.g. "Larch Grove"
  export const AREA_WEIGHTS: Readonly<Record<string, number>>; // the ~20 largest areas weighted (B, M, L, LS, E, N, SE, SW, …); every other UK_POSTCODE_AREAS entry weight 1
  export const REVIEW_TEXTS: readonly { rating: 1|2|3|4|5; title: string; body: string }[]; // ~15
  ```
- `fork(label)` derives a new seed from the parent seed and a string hash (FNV-1a) of `label`. Adding a customer then never shifts another customer's stream.

- [ ] **Step 1: Write the failing tests:**
  - `new Rng(1)` gives the same first 5 `next()` values on two instances, and `new Rng(2)` differs.
  - `fork("a")` is identical across instances and differs from `fork("b")`.
  - `weighted([["x", 0], ["y", 1]])` never returns `"x"` in 1,000 draws.
  - `dateBetween` stays inside the bounds over 1,000 draws.
  - `uuidv7At(new Date("2026-03-01T00:00:00Z"), rng)` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`, and its first 12 hex digits equal `Date.parse("2026-03-01T00:00:00Z").toString(16).padStart(12,"0")`.
  - Every key of `AREA_WEIGHTS` is in `UK_POSTCODE_AREAS`.
- [ ] **Step 2:** Run `vp test --project unit scripts/seed/random.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. mulberry32:
  ```ts
  let t = (this.state += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  ```
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `scripts/seed/random.ts scripts/seed/random.test.ts scripts/seed/names.ts`: `feat: seeded random, time-ordered ids and name lists for the seed`.

---

### Task 3: Stand-in pricer

**Files:**
- Create: `scripts/seed/pricer.ts`, `scripts/seed/pricer.test.ts`

**Interfaces:**
- Consumes: `RatingSource` from `#/server/reference/rating/types`, `RATING_SOURCES`, `CALIBRATION_PEOPLE`.
- Produces:
  ```ts
  // The shapes CALIBRATION_PEOPLE's `inputs` already use, per product
  export type CarInputs = { vehicle: {make;model;year;variant;insuranceGroup;valuePence?;fuelType?}; driver: {age;occupation;licenceYears;noClaimsYears;pastClaims}; namedDrivers?: {age:number}[]; postcodeArea; annualMileage; usage; overnightLocation; voluntaryExcessPence; coverLevel };
  export type HomeInputs = …;     // as calibration H1–H3
  export type BusinessInputs = …; // as calibration B1–B3
  export type PricingInputs = { product: "car"; inputs: CarInputs } | { product: "home"; inputs: HomeInputs } | { product: "business"; inputs: BusinessInputs };

  export interface PricedItem {
    outcome: "quoted" | "referred" | "declined";
    reasonCode: string | null;
    factors: { factor: string; inputValue: string; multiplier: number }[]; // shared by every tier
    options: { coverLevel: CoverLevel; coverMultiplier: number; compulsoryExcessPence: number; annualPremiumPence: number; monthlyPremiumPence: number }[]; // before IPT, all three tiers
    addons: { addon: string; annualPricePence: number; monthlyPricePence: number }[];         // those available to this risk
    ipt(rounded: number): number;  // Math.round(rounded × ipt_rate)
  }
  export function priceItem(source: RatingSource, item: PricingInputs): PricedItem;
  ```
- **Rules,** from 08-reference-data.md "Car v1", "Home v1" and "Business v1":
  - Range factors pick the row whose `rangeFrom ≤ v ≤ rangeTo` (null `rangeTo` means open).
  - Choice factors match `band`.
  - Lookups map key → band through `source.lookups`, then the band factor.
  - Multiply exactly, round to whole pence once per tier, then clamp to `min_premium_pence`. A price above `max_premium_pence` gives outcome `referred`, `premium_above_max`.
  - Monthly is `Math.round(annual × (1 + monthly_credit_charge_rate) / 12)`.
  - Eligibility reads the threshold parameters. The reason codes must equal the calibration ones (`young_driver_high_group`, `high_insurance_group`, …). Read every reason string in `calibration.ts` and the 08 spec's threshold tables.
  - Under 25: add `young_driver_excess_pence` to every tier's compulsory excess.

- [ ] **Step 1: Write the failing tests:**
  - `describe.each(CALIBRATION_PEOPLE)`, finding the source by product:
    - **Quoted:** the selected tier's `annualPremiumPence + ipt(annualPremiumPence)` is within ±1% of `handPence` and inside `[minPence, maxPence]`.
    - **Referred or declined:** `outcome` and `reasonCode` equal `expected`.
  - Every quoted item has three options, and each has `monthlyPremiumPence × 12 ≥ annualPremiumPence`.
  - A car input with a fabricated occupation `"astronaut"` throws `Error(/unknown occupation: astronaut/)`. Never default a multiplier to 1 (5.4 row).
- [ ] **Step 2:** Run `vp test --project unit scripts/seed/pricer.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `priceItem`, with one small base function per product (`carBase`, `homeBase`, `businessBase`) and a shared factor/tier/addon/clamp pipeline. Add a file comment: "Stand-in for 5.4's priceQuote(); 5.4 replaces it and reseeds dev (4.9 call 9)."
- [ ] **Step 4:** Run again. Expected: PASS. If a calibration person misses by more than 1%, fix the pricer, never the calibration file.
- [ ] **Step 5:** Commit `scripts/seed/pricer.ts scripts/seed/pricer.test.ts`: `feat: stand-in pricer for seeded quotes, reading rating tables v1`.

---

### Task 4: Builders, cast, crowd and `generateSeed`

**Files:**
- Create: `scripts/seed/types.ts`, `scripts/seed/builders.ts`, `scripts/seed/cast.ts`, `scripts/seed/crowd.ts`, `scripts/seed/generate.ts`, `scripts/seed/generate.test.ts`

**Interfaces:**
- Consumes: `Rng`, `uuidv7At`, `SEED_FROM/TO` (Task 2), `priceItem` (Task 3), `castEmail` (Task 1), `CatalogueRecord` from `#/server/data/reference`.
- Produces:
  ```ts
  export interface SeedContext {
    catalogue: readonly CatalogueRecord[];
    versions: Record<Product, { id: string; source: RatingSource }>;
    inbox: { local: string; domain: string };
    crowdSize: number;          // 2000 in the script, small in tests
  }
  export type CastRole = "customer-a" | "customer-b" | "business" | "closure-settled" | "closure-held" | "handler" | "admin";
  export interface SeedUser { id: string; email: string; name: string; createdAt: Date; cast: CastRole | null; scrubbed: boolean; staff: { displayName: string; roles: StaffRole[] } | null }
  export interface SeedPlan {
    users: SeedUser[];
    customers, quotes, quoteItems, quoteItemOptions, quoteItemAddons, quoteItemFactors,
    underwritingDecisions, vehicles, drivers, properties, businesses, bundles, policies,
    payments, claims, claimEvents, claimThirdParties, claimMessages, claimSettlements,
    reviews, notifications, events, accountClosures: (typeof table.$inferInsert)[];  // one array per table
    audit: { action: AuditAction; entityId: string; actorUserId: string | null; actorRole: string | null; changes?: Record<string, AuditValue> }[]; // chained by the writer
  }
  export function generateSeed(ctx: SeedContext): SeedPlan;
  ```
- **Staff rows aren't in the plan** (`staff_members.staff_code` depends on what's already in the database). The writer creates them from `SeedUser.staff`. Rows that reference a staff member (`decidedBy`, `assignedHandlerId`, `approvedBy`, `actorUserId`) use the staff `SeedUser.id`, which the plan fixes.
- **Ids:** `uuidv7At(createdAt, rng)` for uuid tables. Users use `uuidv7At` too (the column is text). Identity tables (`quote_item_factors`, `underwriting_decisions`, `claim_events`) omit `id`.
- **The builders** each take `(rng, ctx, …)` and push into a `SeedPlan`:
  - `buildCustomer`
  - `buildQuote`: one or more items; prices through `priceItem`; writes the item's options, add-ons and factors, the first `underwriting_decisions` row (`decided_by` null), and the product detail rows.
  - `decideReferral`: by staff; a second decision row; the outcome on the item updated to match.
  - `acceptQuote`: `paymentPlan`, both confirmations, `status: "accepted"`; bundle row when there are two or more items; `bundleDiscountPence = round(subtotal × bundle_discount_rate)` for bundles; payments.
  - `buildPolicy`: one per bought item; reference; `startsOn`/`endsOn` 12 months; `termsAcceptedAt`.
  - `buildClaim(status)`: the events, messages, third parties and settlement each status implies; `submitted` event and `claim.opened` event for non-drafts; settlement only for `settled` (status `paid`) and `approved` (status `scheduled`).
  - `buildReview`
  - `buildClosure("cancelled" | "closed")`
- **Funnel events,** per quote: `quote.started`, `quote.priced`, then `quote.referred` or `quote.declined`, then `policy.bought`. Per submitted claim: `claim.opened`. `properties` holds product and outcome only, never personal data.
- **Notifications:** `claim.updated` on claim status changes, `referral.decided`, `payment.failed`, `policy.renewal_due` for policies ending within 30 days of `SEED_TO`. `linkPath` like `/account`.
- **Cast** (spec table, fixed choices, cast purchases dated Aug–Oct 2026):
  - Customer A: car + home bundle, a settled car claim, a published 5★ review.
  - B: a car policy, a claim `assessing` assigned to the handler.
  - Business: a business policy, plus a second quote with PL Plus tier and turnover over `refer_turnover_pence_min`, referred, no decision.
  - Closure settled: a car policy, one claim `settled`.
  - Closure held: a home policy, a claim `received`.
  - Handler: staff `claims_handler`.
  - Admin: staff `admin`.
  - Customer emails come from `castEmail`. Names are fixed: "Amelia Hart", "Ben Okafor", "Priya Shah" (Shah Florists), "Tom Reed", "Grace Lin", "Sam Carter" (handler display name "Sam from Kerb claims"), "Jordan Ellis" (admin).
- **Crowd** (`crowdSize` customers, each from `rng.fork("crowd:" + i)`):
  - Sign-ups weighted by month, with Jan and Sep ×1.5.
  - Customers get 1–5 quotes. The product mix and the shares of outcomes, conversion, bundles, policy status, claims and reviews follow spec call 17 as probabilities.
  - Postcode: area by `AREA_WEIGHTS`, then `<area><1–9> <digit><two letters>`.
  - Cars come from `ctx.catalogue` weighted by `1 / insuranceGroup`.
  - Occupations and trades come from the source lookups.
  - About 1% of customers (at least 1 when `crowdSize ≥ 20`) get a cancelled closure and about 0.5% a closed one. The closed ones have no open claims, and their user is scrubbed.
  - The audit sample: `referral.viewed` on each staff decision, `claim.viewed` on each claim the handler moved past `received`, and the closure actions.
  - Conflict of interest: staff have no customer rows, so it holds by construction. Assert it anyway (Step 1).

- [ ] **Step 1: Write the failing tests** in `generate.test.ts`. Build a `SeedContext` with `expandCatalogue` output plus fake ids, `RATING_SOURCES` with fake version ids, and `crowdSize: 50`.
  - **Deterministic:** `generateSeed(ctx)` twice gives deep-equal plans (`expect(a).toEqual(b)`).
  - **Stable under growth:** the first 50 crowd customers are identical when `crowdSize` is 50 and when it's 60 (compare `customers.slice`).
  - **Reconciles:** for every quote, `total = subtotal − bundleDiscount + fees + ipt`, and `subtotal` = the selected options plus the selected add-ons of its items.
  - **Every table is filled:** each `SeedPlan` array is non-empty, and `accountClosures` includes a cancelled one and a closed one.
  - **The cast exists:** each `CastRole` appears exactly once. Customer B's claim has `status: "assessing"` and `assignedHandlerId` = the handler's id. The closure-held customer has a claim in `OPEN_CLAIM_STATUSES`. The closure-settled customer has only `settled` claims. The business owner has an item with `outcome: "referred"` and exactly one decision row.
  - **Dates:** every `createdAt` is within `[SEED_FROM, SEED_TO]`.
  - **Formats:** references match the 9-range patterns.
  - **Conflict of interest:** no claim's `assignedHandlerId` and no decision's `decidedBy` belongs to the same user as the record's customer.
- [ ] **Step 2:** Run `vp test --project unit scripts/seed/generate.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `types.ts`, `builders.ts`, `cast.ts`, `crowd.ts` and `generate.ts` per the Interfaces.
- [ ] **Step 4:** Run again. Expected: PASS. Then generate with `crowdSize: 2000` once in a scratch test and check the rough counts (about 6,000 quotes, 1,500 policies, 300 claims). Tune the probabilities, then delete the scratch test.
- [ ] **Step 5:** Commit the six files: `feat: seed generation for the cast and a year of synthetic customers`.

---

### Task 5: Writer

**Files:**
- Create: `scripts/seed/write.ts`, `scripts/seed/write.int.test.ts`

**Interfaces:**
- Consumes: `generateSeed`, `SeedContext` (Task 4); `getCatalogue`, `getActiveRatingVersion` from `#/server/data/reference`; `RATING_SOURCES`; `AUDIT_LOCK_KEY`, `assertChainable`, `computeHash`, `nextCreatedAt`, `AuditKeys` from `#/server/audit/chain`; `AUDIT_ACTIONS`; `hashPassword`, `symmetricEncrypt` from `better-auth/crypto`.
- Produces:
  ```ts
  export type SeedResult =
    | { action: "already_seeded"; counts: Record<string, number> }
    | { action: "seeded"; counts: Record<string, number>; totpUri: string };
  export class SeedNotReady extends Error {} // message: "Reference data is missing: run vp run db:reference first"
  export async function seedDatabase(
    db: Db,                                   // owner connection
    opts: { config: Pick<SeedConfig, "inbox" | "password" | "totpSecret" | "authSecret">; keys: AuditKeys; crowdSize: number; now?: Date },
  ): Promise<SeedResult>;
  export async function seedCounts(db: Db): Promise<Record<string, number>>; // synthetic users + every SeedPlan table
  ```
- **Order, in one `db.transaction`:**
  1. `exists(users where is_synthetic)` → return `already_seeded` with counts.
  2. Load the context: `getActiveRatingVersion` for each product, then match its `version` to the `RATING_SOURCES` entry. If a version or the catalogue is missing, throw `SeedNotReady`.
  3. `generateSeed`.
  4. Users: `is_synthetic`, `emailVerified` (false for scrubbed), `createdAt`/`updatedAt`. `accounts` (`providerId: "credential"`, `accountId: userId`, `password`): the cast gets `await hashPassword(config.password)`, and the unscrubbed crowd gets one shared hash of a random 32-byte password computed once.
  5. Staff: `staff_members` with codes continuing from `max(substring(staff_code from 3)::int)` (as `make-admin-core.ts` does), `startedAt = SEED_FROM`, then `staff_roles`. `two_factors` for both staff: `secret = await symmetricEncrypt({ key: authSecret, data: totpSecret })`, `backupCodes = await symmetricEncrypt({ key: authSecret, data: JSON.stringify(<10 codes from rng in the XXXXX-XXXXX form>) })`, `verified: true`. Set `users.two_factor_enabled = true`. **Check against Better Auth's backup-code reader** (`node_modules/better-auth/dist/plugins/two-factor/backup-codes/index.mjs`, `getBackupCodes`) that it decrypts this format. If `kerbTwoFactor`'s options store them differently, match that.
  6. The rest in foreign-key order: customers → quotes → quote_items (`selectedOptionId` null) → options, addons, factors → update `selectedOptionId` → details → underwriting decisions → bundles → policies → payments → claims → events, third parties, messages, settlements → reviews → notifications → events → account_closures. Insert in chunks of 500 rows.
  7. Audit: take `pg_advisory_xact_lock(AUDIT_LOCK_KEY)`, read the latest `hash, created_at`, and for each `plan.audit` entry plus a `staff.added` per staff member, build a `ChainRow` with `createdAt = nextCreatedAt(prev, now)`, then `assertChainable` and `computeHash` with `keys.activeVersion`. The insert columns are as in `make-admin-core.ts`.
- **`totpUri`:** `otpauth://totp/Kerb:<handler email>?secret=<base32 of the secret's UTF-8 bytes>&issuer=Kerb`, the same encoding as `src/test/totp.ts`.

- [ ] **Step 1: Write the failing tests** in `write.int.test.ts`. In `beforeEach`: `truncateAll()`, then `upsertReferenceData(getOwnerDb())`. Use `crowdSize: 30`, the test audit keys from `vite.config.ts` and `SECRET` from `src/test/auth.ts` as `authSecret`.
  - **Fills the contract:** after `seedDatabase`, every table where `dataContract[t].copied` is true has `count(*) > 0`. Spec test row 1.
  - **Rerun is a no-op:** a second call returns `already_seeded`, and `seedCounts` before equals after.
  - **The chain verifies:** `verifyAuditChain(getOwnerDb().$client, keys)` returns `ok: true`.
  - **Extends existing data:** pre-insert a staff member `H-001` via `makeStaff` and one `audit()` row. After seeding, the staff codes are unique and include `H-002`, and the chain still verifies.
  - **Atomic:** stub `generateSeed` with `vi.spyOn` to return a plan with one invalid row (a claim with `status: "nonsense"`). The seed rejects, then `select count(*) from users where is_synthetic` is 0 and the `audit_log` count is unchanged.
  - **Needs reference data:** with no `upsertReferenceData`, it rejects with `SeedNotReady`.
  - **Every row is synthetic:** `select count(*) from customers c join users u on u.id = c.user_id where not u.is_synthetic` is 0.
  - **A cast customer can sign in:** use the `src/test/auth.ts` helpers to sign in with `castEmail(inbox,"customer-a")` and `SEED_PASSWORD`. Expect a session.
  - **The handler can sign in with a code:** sign in as the handler, then complete `/two-factor/verify-totp` with `totpNow(<base32 of totpSecret>)` (`src/test/totp.ts`). Expect a session with `two_factor_verified_at` set.
- [ ] **Step 2:** Run `vp run db:test:up` and then `vp test --project integration scripts/seed/write.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `write.ts`.
- [ ] **Step 4:** Run again. Expected: PASS. Then run the full `vp test --project integration`: nothing else may break, and the factories' sequences are unaffected.
- [ ] **Step 5:** Commit `scripts/seed/write.ts scripts/seed/write.int.test.ts`: `feat: seed writer, one transaction with auth rows and the audit chain`.

---

### Task 6: Entry script, docs, run on `dev`

**Files:**
- Create: `scripts/seed.ts`
- Modify: `package.json` (`"db:seed": "node scripts/seed.ts"` after `db:reference`), `plan/engineering.md` §3, `plan/phases/05-quote/phase.md` (5.4 row)

**Interfaces:**
- Consumes: `readSeedConfig`, `SeedConfigError` (Task 1); `seedDatabase`, `SeedNotReady` (Task 5); `parseKeys` (as `make-admin.ts` does); `failureLine` from `scripts/reset-two-factor-core.ts`.

- [ ] **Step 1:** Write `scripts/seed.ts` on the `reference-data.ts` pattern:
  - `loadEnvFile(".env.local")`, then `readSeedConfig(process.env)`. On error, print one line per reason and exit 1. The messages name the variable and never print its value.
  - `parseKeys`.
  - Print `Database: <host>`.
  - Boot the module runner, import `/scripts/seed/write.ts` and the schema, and build the Drizzle owner pool (`max: 1`).
  - `seedDatabase(db, { crowdSize: 2000, … })`.
  - Print either `Already seeded:` or `Seeded:`, then `<table> <count>` lines. On `seeded`, also print `Staff 2FA: add this to your authenticator app: <totpUri>`.
  - `SeedNotReady` prints its message. Anything else goes through `failureLine`. Always close the runner and the pool.
- [ ] **Step 2:** Run it with a wrong `SEED_DATABASE_HOST`: `SEED_DATABASE_HOST=nope vp run db:seed`. Expected: exit 1, "SEED_DATABASE_HOST doesn't match", no connection made.
- [ ] **Step 3: Docs.**
  - `engineering.md` §3 gets a "Seed data on dev (4.9)" paragraph: `vp run db:seed`; a rerun does nothing; reseed with Neon "Reset from parent" on `dev`, then `db:migrate`, `db:reference`, `db:seed`, and `auth:make-admin` for your own admin.
  - The 5.4 row gets: "Replace the 4.9 stand-in pricer (`scripts/seed/pricer.ts`) with `priceQuote()` and reseed `dev`. Generated references stay below the seed's 9 range (4.9 call 19)."
- [ ] **Step 4: Gate.** Run `vp check`, then `vp test`, then `vp build`. Expected: all pass.
- [ ] **Step 5:** Commit `scripts/seed.ts package.json plan/engineering.md plan/phases/05-quote/phase.md`: `feat: vp run db:seed for dev`.
- [ ] **Step 6: Damion runs it.** Damion sets the `.env.local` values (spec "What you set up") and runs `vp run db:seed`. Expected: `Seeded:` with about 2,000 customers, then a second run prints `Already seeded:` with the same counts. Record both outputs in the spec's Results.
- [ ] **Step 7: Staging checks (Damion).** On the staging URL, sign in as customer A, then as the handler with a code from the authenticator app. Expected: both work. If the handler's code fails but works locally, the `BETTER_AUTH_SECRET` values differ (spec "What you set up").
- [ ] **Step 8: The closure check** (spec section "The 30-day closure check"). On staging, request closure as closure-settled and closure-held. Then run `NOW=<requested + 31 days, ISO> vp run account:run-closures` locally. In Neon, settled is closed and scrubbed with its policy and claim kept, and held has `held_since` set. The emails arrive in Damion's inbox. Record the results in the spec, and tick the 4.7 carried box.
- [ ] **Step 9: PR.**
  - Mark the slice done: spec Status, the `phase.md` 4.9 row, the `build-plan.md` box.
  - Push `slice/4.9-seed-data`, then open the PR into `staging` with the spec's commit message as the title. The body links the spec and copies its "Done when" list.
  - Stage by name. Put the `Co-Authored-By` trailer in a commit, not only the PR body.
