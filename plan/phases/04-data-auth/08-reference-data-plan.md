# 4.8 Reference data: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real UK vehicle catalogue and rating tables v1 for car, home and business, in Postgres, loaded idempotently on every staging and production deploy, read through memoised data-layer functions.

**Architecture:**
- **Source of truth is typed TypeScript** under `src/server/reference/`: rating versions, postcode bands, the catalogue by make, and the calibration people. Zod plus a validator refuse a bad source before anything is written. These files import nothing from the database, only `#/server/db/schema/values`.
- **One data module, `src/server/data/reference.ts`,** owns every query: `upsertReferenceData` (writes, as the owner) and the readers `getCatalogue`, `getRatingTables` and `getActiveRatingVersion` (as `kerb_app`, memoised in module scope).
- **`scripts/reference-data.ts`** runs the upsert through Vite's module runner, as `run-closures.ts` does. `db-deploy.ts` runs it after a successful migrate.

**Tech Stack:** Drizzle 0.45 + node-postgres, zod 4.6, Postgres 18 (Docker on `localhost:5433`), Vitest via `vite-plus/test` (`unit`, `integration`), Vite+ module runner for scripts.

**Spec:** [08-reference-data.md](08-reference-data.md) (approved 8 Nov 2026). Read it first. Call numbers below are the spec's. Every number in the rating tables comes from the spec's "Rating tables v1" section, copied exactly.

## Global Constraints

- **Branch and PR:**
  - Work in the main folder on `feat/4.8-reference-data` (from `staging`). No worktree.
  - One commit per task (Conventional Commits), ending with the `Co-Authored-By` trailer.
  - Nothing is pushed until Damion says so. The PR goes into `staging` and is squash-merged with the spec's commit message.
- **Money** is integer pence everywhere. Multipliers have at most 4 decimal places (`numeric(8,4)`), and parameters are `numeric(14,4)`.
- **The 121 UK postcode areas** are exactly this list (exported as `UK_POSTCODE_AREAS`):
  `AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY E EC EH EN EX FK FY G GL GU HA HD HG HP HR HS HU HX IG IP IV KA KT KW KY L LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE`.
  `JE`, `GY` and `IM` are never listed (call 13).
- **Valuation date** is `2026-11-01`, so age = `2026 − year`. Catalogue years run from 2012 to 2026. Every v1 version has `effectiveFrom: "2026-11-01"`.
- **Cover levels:** `essential`, `comprehensive`, `plus`.
- **Lookup kinds:** `postcode_area`, `occupation`, `trade`.
- **Factor names (copied from the spec):**

  | Product | Factors |
  |---|---|
  | Car | `driver_age`, `no_claims_years`, `licence_years`, `insurance_group`, `annual_mileage`, `usage`, `overnight_location`, `fuel_type`, `vehicle_age`, `past_claims`, `voluntary_excess`, `named_driver_age`, `occupation_band`, `postcode_band` |
  | Home | `property_type`, `year_built`, `buildings_postcode_band`, `contents_postcode_band`, `burglar_alarm`, `lock_type`, `smoke_alarm`, `bedrooms`, `past_claims` |
  | Business | `turnover_band`, `postcode_band` |

  Business also has the parameters `pl_rate_pence_a`…`pl_rate_pence_e` and `el_rate_pence_a`…`el_rate_pence_e`.
- **Data layer:** only `src/server/data/` and `scripts/` query the database (4.5 lint rule). `reference.ts` isn't a protected read: it is excluded from the permission suite's completeness scan, as `account.ts` is, and isn't re-exported from `index.ts`.
- **Logs:** counts, products and versions only, never connection strings.
- **Tests:**
  - Imports come from `vite-plus/test`.
  - Integration tests call `truncateAll()` in `beforeEach`. They write reference data with `getOwnerDb()` (from `src/test/db.ts`) and read with `getDb()`, which connects as `kerb_app`.
  - `vp check` and `vp test` pass at the end of every task (`vp run db:test:up` first).

## Review Focus

1. **Postgres silently rounds a multiplier with 5+ decimals.** The stored tables would no longer match the source and its hash. The validator refuses more than 4 decimal places (Task 2).
2. **One bad source, partial write.** Every source is validated before the first write, so a broken business source leaves car and home unwritten too (Task 7).
3. **Two deploys running the upsert at once** (a quick staging redeploy). Each transaction takes `pg_advisory_xact_lock`, so both finish and the second is a no-op (Task 7).
4. **A caller mutating the cached tables** would change every later quote in that instance. The cached objects are deep-frozen (Task 7).
5. **A renamed variant.** The old row is deactivated and keeps its id, so a vehicle linked to it still joins; the new name is a new row (Task 7).

---

### Task 1: Schema, migration, grants and contract

**Files:**
- Create: `src/server/db/schema/reference.ts`
- Modify: `src/server/db/schema/values.ts`, `src/server/db/schema/index.ts`, `src/server/db/schema/products.ts` (vehicles), `src/server/db/schema/underwriting.ts` (rating_versions), `src/server/db/data-contract.ts`, `src/test/factories.ts` (`makeRatingVersion`), `scripts/check-app-role-core.ts`
- Create: `drizzle/0014_*.sql` (generated), `drizzle/0015_reference_data_grants.sql` (custom)
- Test: `src/server/db/reference.int.test.ts`, `scripts/check-app-role.int.test.ts`

**Interfaces:**
- Produces (in `values.ts`):
  - `bodyStyles = ["hatchback","saloon","estate","suv","coupe","convertible","mpv"]`
  - `transmissions = ["manual","automatic"]`
  - `coverLevels = ["essential","comprehensive","plus"]`
  - `lookupKinds = ["postcode_area","occupation","trade"]`
- Produces (Drizzle tables in `reference.ts`):

  | Table | Columns |
  |---|---|
  | `vehicleCatalogue` | `id` (uuidv7), make, model, year, variant, bodyStyle, fuelType, transmission, doors, engineCc (nullable), powerBhp, insuranceGroup, valuePence, isActive (default true), createdAt, updatedAt; unique `(make, model, year, variant)`; index `(make, model, year)` |
  | `ratingParameters` | id (bigint identity), ratingVersionId, name, value `numeric(14,4)`, createdAt; unique `(ratingVersionId, name)` |
  | `ratingTiers` | id, ratingVersionId, coverLevel, multiplier, compulsoryExcessPence, createdAt; unique `(ratingVersionId, coverLevel)` |
  | `ratingAddons` | id, ratingVersionId, addon, annualPricePence, factors `text[]` (default `{}`), availableToGroups `text[]` (nullable), createdAt; unique `(ratingVersionId, addon)` |
  | `ratingFactors` | id, ratingVersionId, factor, band, rangeFrom and rangeTo (`bigint`, nullable), multiplier `numeric(8,4)`, createdAt; unique `(ratingVersionId, factor, band)` |
  | `ratingLookups` | id, ratingVersionId, lookup, factor, key, label, group (nullable), band, createdAt; unique `(ratingVersionId, factor, key)` |

  - The five rating tables have `ratingVersionId` → `rating_versions` with `CASCADE`.
  - Checks: multipliers `> 0`, prices `> 0`, excess `≥ 0`, `insurance_group` 1–50, `doors` 2–7, `value_pence > 0`, `power_bhp > 0`, the closed sets via `oneOf`, `range_to is null or range_to >= range_from`.
- Produces:
  - `vehicles.catalogueVariantId` (uuid, nullable, FK `RESTRICT`, indexed)
  - `ratingVersions.contentHash` (text, nullable)

- [ ] **Step 1: Write the failing integration tests** in `src/server/db/reference.int.test.ts`:
  - `it("refuses kerb_app writes on every reference table")`: for each of the six tables, an `INSERT` through `getDb()` rejects with SQLSTATE `42501`. Seed one row per table with `getOwnerDb()` (a rating version made by `makeRatingVersion()`), then check `UPDATE` and `DELETE` through `getDb()` also reject with `42501`, and `SELECT` returns the row.
  - `it("refuses deleting a catalogue row a vehicle points at")`: an owner-inserted catalogue row; `makeQuote({ products: ["car"] })`, then the vehicle's `catalogue_variant_id` set to it (owner). An owner `DELETE` of the catalogue row rejects with `23503`.
  - `it("refuses a multiplier of 0 and a range_to below range_from")`: two owner inserts, each rejecting with `23514`.
  - `it("records deletes of rating rows in deleted_rows")`: deleting a draft version as the owner cascades. `deleted_rows` gets one row per deleted factor (`table_name = 'rating_factors'`).
  - Add to `scripts/check-app-role.int.test.ts`: the check named `"writes on reference tables refused"` passes.
- [ ] **Step 2: Run them.** `vp test --project integration src/server/db/reference.int.test.ts` should fail because the tables don't exist.
- [ ] **Step 3: Add the schema** above. Then run `vp run db:generate`, which creates `0014`.
- [ ] **Step 4: Write `drizzle/0015_reference_data_grants.sql`** with `drizzle-kit generate --custom --name reference_data_grants`:
  - `vehicle_catalogue_set_updated_at` (`set_updated_at()`)
  - `<table>_record_delete` (`record_delete('id')`) on all six tables
  - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON <six tables> FROM kerb_app`
  - Header comment citing calls 18 and the 4.5b default grants.
- [ ] **Step 5: Add data-contract entries.** Everything is `copied: true`, with every column `keep`.
  - `vehicle_catalogue`: `mutable`, `changeColumn: "updated_at"`.
  - The five rating tables: `append-only`, `changeColumn: "created_at"`. Each grain is "one <thing> of one rating version".
  - Add `catalogue_variant_id` and `content_hash` to their tables' entries.
- [ ] **Step 6: Update the factory and the role check.**
  - `makeRatingVersion` uses `version: 1000 + next()`.
  - `check-app-role-core.ts` adds `"writes on reference tables refused"`: none of `has_table_privilege(current_user, 'public.<t>', 'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE')` is true for the six tables.
- [ ] **Step 7: Run the tests.** `vp test --project integration` and `vp test --project unit src/server/db/data-contract.test.ts` should pass, and `vp run db:check` should pass.
- [ ] **Step 8: Commit.** `feat(db): reference data tables, read-only to kerb_app, with contract entries`

### Task 2: Rating source types, validation and hash

**Files:**
- Create: `src/server/reference/rating/types.ts`, `src/server/reference/rating/validate.ts`, `src/server/reference/rating/hash.ts`, `src/server/reference/postcode-areas.ts` (`UK_POSTCODE_AREAS` only, for now)
- Test: `src/server/reference/rating/validate.test.ts`, `src/server/reference/rating/hash.test.ts`

**Interfaces:**
- Produces the type `RatingSource`:

  ```ts
  interface RatingSource {
    product: Product; version: number; effectiveFrom: string; notes: string;
    parameters: Record<string, number>;
    tiers: { coverLevel: CoverLevel; multiplier: number; compulsoryExcessPence: number }[];
    addons: { addon: string; annualPricePence: number; factors: string[]; availableToGroups: string[] | null }[];
    factors: { factor: string; band: string; rangeFrom: number | null; rangeTo: number | null; multiplier: number }[];
    lookups: { lookup: LookupKind; factor: string; key: string; label: string; group: string | null; band: string }[];
  }
  ```

- Produces:
  - `ratingSourceSchema` (zod)
  - `validateRatingSource(source: RatingSource): string[]`, which returns problems, empty if valid
  - `RANGE_FLOORS: Record<string, number>`: `driver_age` and `named_driver_age` are 17; any other range factor floors at 0
  - `REQUIRED_PARAMETERS: Record<Product, string[]>`, with exactly the parameter names in the spec tables for each product
  - `contentHash(source: RatingSource): string` (64 hex characters)
  - `UK_POSTCODE_AREAS: readonly string[]`

- [ ] **Step 1: Write the failing unit tests** in `validate.test.ts`. Start from a minimal valid car fixture built in the test (all required parameters, three tiers, one range factor `driver_age` 17–24 / 25+, one categorical factor, `postcode_band` bands 1–10, and a `postcode_area` lookup covering all 121 areas). It returns `[]`. Each mutation returns a message containing the quoted text:

  | Mutation | Message contains |
  |---|---|
  | A gap (17–24, 26+) | `driver_age: gap after 24` |
  | An overlap (17–25, 25+) | `driver_age: overlap at 25` |
  | Last band has a `rangeTo` | `driver_age: no open-ended top band` |
  | First band starts at 18 | `driver_age: starts at 18, floor is 17` |
  | A lookup pointing to band `11` | `postcode_band: unknown band 11` |
  | `LS` missing | `postcode_band: missing area LS` |
  | `LS` twice | `postcode_band: area LS listed twice` |
  | `JE` added | `postcode_band: JE is outside the cover area` |
  | Only two tiers | `tiers: expected essential, comprehensive, plus` |
  | Multiplier `0` | `multiplier must be > 0` |
  | Multiplier `1.02201` | `more than 4 decimal places` |
  | An add-on with factor `nope` | `addon breakdown_uk: unknown factor nope` |
  | `ipt_rate` missing | `missing parameter ipt_rate` |

- [ ] **Step 2: Write `hash.test.ts`.**
  - The same source with its arrays and object keys shuffled gives the same hash.
  - Changing one multiplier from `1.07` to `1.0701` changes it.
  - `notes` changes don't change it (notes aren't rates).
- [ ] **Step 3: Run them.** `vp test --project unit src/server/reference` should fail.
- [ ] **Step 4: Implement.**
  - `contentHash` is SHA-256 (`node:crypto`) of canonical JSON. Every array is sorted by its key fields. Numbers are formatted with `toFixed(4)` for multipliers and parameters, and as integers for pence. The input includes `product` and `version` but not `notes` or `effectiveFrom`.
  - Decimal places are checked by `Math.round(x * 1e4) / 1e4 === x`.
- [ ] **Step 5: Run the tests.** They should pass.
- [ ] **Step 6: Commit.** `feat(reference): rating source schema, validation and content hash`

### Task 3: Postcode bands for all 121 areas

**Files:**
- Modify: `src/server/reference/postcode-areas.ts`
- Test: `src/server/reference/postcode-areas.test.ts`

**Interfaces:**
- Produces `POSTCODE_AREAS_V1: readonly PostcodeArea[]`, where:

  ```ts
  interface PostcodeArea {
    area: string; label: string; region: string;
    car: Band; buildings: Band; contents: Band; reason: string;
  }
  ```

  `Band` is `1 … 10`. `label` is the area's main town (`LS` → `Leeds`).

- [ ] **Step 1: Write the failing test.**
  - The areas equal `UK_POSTCODE_AREAS` exactly.
  - Every band is 1–10, and every `reason` is non-empty.
  - The spec's anchors hold:

    | Area | Car | Buildings | Contents |
    |---|---|---|---|
    | `LS` | 5 | 4 | 6 |
    | `E` | 9 | 6 | 9 |
    | `EX` | 2 | | |
    | `BS` | 5 | | |
    | `SY` | | 7 | 2 |
    | `DE` | | | 4 |
    | `NG` | | | 5 |
    | `G` | | | 6 |

    Business uses the contents band, so the B1–B3 people need `DE`, `NG` and `G` set as shown.
  - The bands run the right way: `WC`, `E`, `N` and `B` have car bands ≥ 8; `LD`, `HS` and `ZE` have car bands ≤ 2; the average car band in `region === "London"` is greater than in `"South West"`.
- [ ] **Step 2: Run it.** `vp test --project unit src/server/reference/postcode-areas.test.ts` should fail.
- [ ] **Step 3: Research and fill the 121 rows** by the spec's call 23 method. Each `reason` is one line naming the data behind it, e.g. "Confused.com Q3 2026 Yorkshire 1.01× UK; MSM Bradford city premium", or "EA flood: Severn valley; BGS low clay".
- [ ] **Step 4: Run it.** It should pass.
- [ ] **Step 5: Commit.** `feat(reference): postcode risk bands for 121 UK areas`

### Task 4: Rating versions v1 and the calibration people

**Files:**
- Create: `src/server/reference/rating/car-v1.ts`, `home-v1.ts`, `business-v1.ts`, `index.ts` (`RATING_SOURCES`), `calibration.ts`
- Test: `src/server/reference/rating/sources.test.ts`

**Interfaces:**
- Consumes: `RatingSource`, `validateRatingSource`, `POSTCODE_AREAS_V1`
- Produces:
  - `RATING_SOURCES: readonly RatingSource[]` (car, home, business, version 1)
  - `CALIBRATION_PEOPLE: readonly CalibrationPerson[]`

    ```ts
    interface CalibrationPerson {
      id: string; product: Product; inputs: Record<string, unknown>;
      expected:
        | { outcome: "quoted"; minPence: number; maxPence: number; handPence: number }
        | { outcome: "referred" | "declined"; reason: string };
    }
    ```

  - Ids `C1`–`C6`, `H1`–`H3`, `B1`–`B3`. Targets and hand figures come from the spec's example table, in pence, including IPT.
  - `inputs` use catalogue `{ make, model, year, variant }` and lookup keys.
- The postcode lookups are generated from `POSTCODE_AREAS_V1`:
  - car: `postcode_band` ← `car`
  - home: `buildings_postcode_band` ← `buildings` and `contents_postcode_band` ← `contents`
  - business: `postcode_band` ← `contents`
  - `group` is the region.
- The `insurance_group` factor has 50 rows, built with `Number((1.022 ** (g - 15)).toFixed(4))`. Bands are `"1"`…`"50"` and each `rangeFrom = rangeTo = g`.
- Discrete numeric bands (`voluntary_excess` in pence, `past_claims`) use exact ranges. The top band is open-ended.
- Occupation and trade keys are snake_case versions of the spec's lists. Trades have `group` set to the spec's group slug (`office_professional`, `retail`, `food_hospitality`, `hair_beauty_wellbeing`, `trades_construction`), which is what `availableToGroups` names.

- [ ] **Step 1: Write the failing test** `sources.test.ts`:
  - `validateRatingSource` returns `[]` for each of `RATING_SOURCES`.
  - Spot values from the spec: car `base_rate_pence` 46000; `insurance_group` band `"50"` is 2.1418 and band `"1"` is 0.7374; home `contents_rate_pence` 190; the business `plus` tier has multiplier 1.40 and excess 10000; `professional_indemnity` has `availableToGroups` `["office_professional"]` and `factors` `["turnover_band"]`.
  - Counts: 47 occupations (10 + 11 + 11 + 10 + 5), 30 trades, 5 occupation bands.
  - Calibration: every C/H/B person's lookup keys exist in their product's v1 lookups. The catalogue check is added in Task 6.
- [ ] **Step 2: Run it.** It should fail.
- [ ] **Step 3: Write the three sources and `calibration.ts`** from the spec, value for value. Each file's header comment names the sources (the spec's Sources table) and says the numbers are Kerb's estimates, not an insurer's rates.
- [ ] **Step 4: Run it.** It should pass.
- [ ] **Step 5: Commit.** `feat(reference): rating tables v1 for car, home and business, with calibration people`

### Task 5: Catalogue types, curves and expansion

**Files:**
- Create: `src/server/reference/catalogue/types.ts`, `src/server/reference/catalogue/expand.ts`
- Test: `src/server/reference/catalogue/expand.test.ts`

**Interfaces:**
- Produces:

  ```ts
  interface MakeSource { make: string; generations: Generation[] }
  interface Generation {
    model: string; bodyStyle: BodyStyle; curve: "standard" | "electric" | "prestige";
    years: [number, number]; groupSource: string; variants: VariantSource[];
  }
  interface VariantSource {
    name: string; fuelType: FuelType; transmission: Transmission; doors: number;
    engineCc: number | null; powerBhp: number; insuranceGroup: number; newPricePence: number;
    years?: [number, number];  // narrows the generation's years
  }
  interface CatalogueRow {
    make: string; model: string; year: number; variant: string; bodyStyle: BodyStyle;
    fuelType: FuelType; transmission: Transmission; doors: number; engineCc: number | null;
    powerBhp: number; insuranceGroup: number; valuePence: number;
  }
  ```

- Produces:
  - `catalogueSourceSchema` (zod)
  - `valuePence(newPricePence: number, year: number, curve: Curve): number`
  - `expandCatalogue(makes: readonly MakeSource[]): CatalogueRow[]`, which throws `CatalogueError` with a message naming the make, model and variant on a duplicate key or a year outside 2012–2026

- [ ] **Step 1: Write the failing tests.** The expected values are worked by hand in a comment above each one, as 5.4 requires.
  - Standard, new price £20,000, year 2023 (age 3): 0.57 → `1140000`.
  - Standard, new price £20,000, year 2018 (age 8): 0.44 × 0.9³ = 0.320760 → £6,415.20, which rounds to `640000`.
  - Electric, new price £40,000, year 2024 (age 2): 0.55 → `2200000`.
  - Prestige, new price £100,000, year 2020 (age 6): 0.60 × 0.93 = 0.558 → `5580000`.
  - The floor: standard, new price £5,000, year 2012 (age 14) works out to £852, so the floor gives `100000`.
  - Age 0: standard, £20,000, 2026 → `1840000`.
  - `expandCatalogue`:
    - A generation 2019–2021 with two variants, one narrowed to 2020–2021, gives 5 rows.
    - A duplicate variant name in the same years throws `CatalogueError`, naming it.
    - A generation with years 2010–2013 throws.
- [ ] **Step 2: Run it.** `vp test --project unit src/server/reference/catalogue` should fail.
- [ ] **Step 3: Implement.**
  - The curve tables come from the spec's call 7 (ages 0–5, then the later-years factor, then the floor). They're applied in the order multiply, round to the nearest £50 (`Math.round(p / 5000) * 5000`), then floor.
  - Validate with the schema: doors 2–7, group 1–50, `engineCc` null exactly when the fuel is electric, and so on.
- [ ] **Step 4: Run it.** It should pass.
- [ ] **Step 5: Commit.** `feat(reference): catalogue source types and expansion with depreciation curves`

### Task 6: Catalogue data, make by make

**Files:**
- Create: `src/server/reference/catalogue/makes/{ford,vauxhall,volkswagen,nissan,toyota,kia,hyundai,peugeot,mg,bmw,mercedes-benz,audi,mini,skoda,renault,dacia,tesla,porsche,land-rover}.ts` and `src/server/reference/catalogue/index.ts` (`CATALOGUE_SOURCES`)
- Test: `src/server/reference/catalogue/catalogue.test.ts`; modify `rating/sources.test.ts`

**Interfaces:**
- Consumes: `MakeSource`, `expandCatalogue`
- Produces: `CATALOGUE_SOURCES: readonly MakeSource[]`

- [ ] **Step 1: Write the failing test** `catalogue.test.ts`:
  - `expandCatalogue(CATALOGUE_SOURCES)` doesn't throw and gives between 1,500 and 3,500 rows.
  - The `(make, model)` set contains every everyday model in the spec's table (41) plus `Porsche 911` and `Land Rover Range Rover Sport`.
  - The variants named in the spec's performance table are present: a variant name containing `M3` under `BMW 3 Series`, `A 45 S` under `Mercedes-Benz A-Class`, `RS 3` under `Audi A3`, `Golf R` and `GTI` under `Volkswagen Golf`, `ST` under both `Ford Focus` and `Ford Fiesta`, and `Performance` under `Tesla Model 3`.
  - Production ranges hold: `Ford Fiesta` has no rows after 2023 and `Ford Puma` none before 2020.
  - Every performance variant has group ≥ 45, except `Golf GTI` and the Fiesta and Focus `ST`, which have groups between 25 and 44. That's what makes C5 and C6 refer or decline.
  - Every generation has a non-empty `groupSource`.
- [ ] **Step 2: Extend `sources.test.ts`.** Each calibration person's `{ make, model, year, variant }` is a catalogue row, and its group matches the person's stated group: C1 14, C2 6, C3 9, C4 40, C5 50, C6 50. Adjust a person's variant (not the spec's group) if the published trim differs, and note it in `calibration.ts`.
- [ ] **Step 3: Run them.** They should fail.
- [ ] **Step 4: Fill the makes.**
  - Each generation needs real trims, published groups and new prices, with `groupSource` naming the page used (Parkers, Honest John, What Car? or a comparison site).
  - Cars launched after August 2024 that only have a Vehicle Risk Rating get an estimated group, with a comment saying so (call 6).
- [ ] **Step 5: Run them.** They should pass.
- [ ] **Step 6: Commit.** `feat(reference): vehicle catalogue of popular UK cars plus performance models`

### Task 7: Upsert and memoised readers

**Files:**
- Create: `src/server/reference/index.ts` (re-exports `RATING_SOURCES`, `CATALOGUE_SOURCES`), `src/server/data/reference.ts`
- Modify: `src/server/data/permissions.int.test.ts` (add `"!./reference.ts"` to the completeness glob, with a comment)
- Test: `src/server/data/reference.int.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6
- Produces:

  ```ts
  interface UpsertResult {
    catalogue: { inserted: number; updated: number; deactivated: number };
    versions: { product: Product; version: number; action: "inserted" | "unchanged" }[];
  }
  class ReferenceDataConflict extends Error {}  // message: "car v1 is already in the database with different tables; add v2 instead"
  upsertReferenceData(db: Db, sources?: { rating: readonly RatingSource[]; catalogue: readonly MakeSource[] }): Promise<UpsertResult>
  getCatalogue(db: Db): Promise<readonly CatalogueRecord[]>  // active rows, CatalogueRow & { id }
  getRatingTables(db: Db, ratingVersionId: string): Promise<RatingTables>
  getActiveRatingVersion(db: Db, product: Product): Promise<{ id: string; version: number } | null>
  clearReferenceCaches(): void  // tests only
  ```

  `RatingTables` is `RatingSource` minus `notes`, plus `id`, with numeric strings parsed to numbers and everything deep-frozen.

- [ ] **Step 1: Write the failing integration tests** in `src/server/data/reference.int.test.ts`. Writes use `getOwnerDb()`; reads use `getDb()`.
  - `it("inserts v1 of each product as active, with every row")`:
    - There are three `rating_versions` rows with `status = 'active'`, `effective_from = 2026-11-01` and a 64-character `content_hash`.
    - Each table's row count equals the source's.
    - The catalogue count equals `expandCatalogue(CATALOGUE_SOURCES).length`.
  - `it("changes nothing on a second run")`: the second result has `inserted`, `updated` and `deactivated` all 0 and every version `unchanged`, and the ids and `updated_at` values are the same.
  - `it("refuses an edited version and writes nothing")`: car v1 is edited (one multiplier changed) after a first run. The run rejects with `ReferenceDataConflict` and the message `car v1 is already in the database with different tables; add v2 instead`. The tables are unchanged.
  - `it("validates every source before writing")`: with an empty database, sources where business is invalid reject with an error listing the problem, and no `rating_versions` and no catalogue rows exist.
  - `it("updates a corrected catalogue row in place")`: one variant's group is changed in the source. Then `updated` is 1, the id is the same, and the new group and a later `updated_at` are stored.
  - `it("deactivates a variant removed from the source, keeping its id")`: `deactivated` is 1, the row is `is_active = false`, and `getCatalogue` leaves it out.
  - `it("activating v2 retires v1")`: with a car v2 source (copy of v1, version 2, `effectiveFrom: "2026-12-01"`), v1 becomes `retired` with `effective_to = 2026-12-01`, and v2 is `active`.
  - `it("survives two runs at once")`: `Promise.all([upsert, upsert])` resolves, and there are exactly three versions.
  - `it("memoises rating tables per version")`:
    - Two calls return the same object (`toBe`).
    - After the owner deletes that version's factors, a third call still returns the cached object.
    - After `clearReferenceCaches()`, the result has no factors.
    - `Object.isFrozen(tables.factors[0])` is true.
  - `it("returns the active version")`: `getActiveRatingVersion(db, "car")` gives `{ version: 1 }`, and gives `null` for an empty database.
  - `it("loads the catalogue once per instance")`: the same object comes back after the owner inserts another row.
- [ ] **Step 2: Run them.** `vp test --project integration src/server/data/reference.int.test.ts` should fail.
- [ ] **Step 3: Implement.**
  - Validate all sources (Zod, `validateRatingSource`, `expandCatalogue`) first, and throw one error listing every problem.
  - Then one transaction for the catalogue and one per rating source. Each starts with `select pg_advisory_xact_lock(hashtext('kerb:reference-data'))`.
  - Catalogue:
    - Insert in batches of 500 with `onConflictDoUpdate` on the natural key, with `setWhere` so only rows whose columns differ are updated. Count inserted against updated with `(xmax = 0)`.
    - Then set `is_active = false` where the key isn't in the source and the row is active, and set it back to true for a key that has returned.
  - Rating version:
    - If it's missing: retire any active version for the product (`effective_to` = the new `effectiveFrom`), then insert the new one as `active` with the hash, then insert its rows.
    - If it's present with an equal hash: `unchanged`.
    - If it's present with a different hash: throw `ReferenceDataConflict`.
  - The memos are module-level maps of promises, deleted when a promise rejects.
- [ ] **Step 4: Run them.** They should pass. Then `vp test --project integration src/server/data/permissions.int.test.ts` should still pass.
- [ ] **Step 5: Commit.** `feat(data): idempotent reference-data upsert and memoised catalogue and rating readers`

### Task 8: Script, deploy step and docs

**Files:**
- Create: `scripts/reference-data.ts`
- Modify:
  - `package.json` (`"db:reference": "node scripts/reference-data.ts"`)
  - `scripts/db-deploy.ts`, `scripts/db-deploy-plan.ts` and its test
  - `plan/phases/04-data-auth/phase.md` (4.8 row, testing row, 5.2 and 5.3 rows)
  - `plan/engineering.md` (§3 deploy step, the server memory row)
  - `plan/build-plan.md`, and the spec's Steps checklist

**Interfaces:**
- Consumes: `upsertReferenceData`, `UpsertResult`

- [ ] **Step 1: Update `db-deploy-plan.test.ts`** to expect the migrate message `db:deploy: applying migrations and reference data for staging`, keeping the skip and fail cases. Run `vp test --project unit scripts/db-deploy-plan.test.ts`. It should fail.
- [ ] **Step 2: Change the message** in `db-deploy-plan.ts`. Run the test again; it should pass.
- [ ] **Step 3: Write `scripts/reference-data.ts`**, modelled on `run-closures.ts`:
  - Load `.env.local` if present.
  - Require `DATABASE_URL_UNPOOLED` (the owner). If it's missing, print `DATABASE_URL_UNPOOLED is not set (the owner connection; the app role can't write reference data).` and exit 1.
  - Print `Database: <host>` via `databaseHost`.
  - Build a Pool + drizzle client (`schema`, `casing: "snake_case"`).
  - Import `upsertReferenceData` through the module runner.
  - Print one line per version (`car v1: inserted|unchanged`) and `Catalogue: N inserted, N updated, N deactivated`, or `Reference data: no changes` when nothing changed.
  - On error, print `failureLine(error)`, or the `ReferenceDataConflict` message as is, and exit 1.
- [ ] **Step 4: Update `db-deploy.ts`.** After a migrate with exit status 0, `spawnSync("node scripts/reference-data.ts", { stdio: "inherit", shell: true })`, then exit with its status. Replace the "4.8 adds…" comment.
- [ ] **Step 5: Run it locally.**
  - `vp run db:reference` against Neon `dev` (`.env.local`) prints three `inserted` lines.
  - A second run prints `Reference data: no changes`.
  - `vp run db:check-app-role` passes, including `writes on reference tables refused`.
- [ ] **Step 6: Update the docs.**
  - `phase.md` 4.8 row: the table names, the read-only grants and the generic rating tables.
  - 5.2 row: decision 2's message, linking to `hello@kerb.opsedsolutions.com`.
  - 5.3 row: occupations come from the active version's `occupation` lookups.
  - engineering.md §3: migrate, then the reference upsert, same targets.
  - build-plan: leave 4.8 unticked until the merge.
- [ ] **Step 7: Run the full checks.** `vp check`, `vp test` and `vp build` should all pass.
- [ ] **Step 8: Commit.** `feat: run the reference-data upsert after migrations on staging and production deploys`
