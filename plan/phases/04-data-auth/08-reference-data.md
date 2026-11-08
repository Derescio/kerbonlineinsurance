# 4.8 Reference data

**Status:** approved (Damion, 8 Nov 2026); built on `feat/4.8-reference-data`, PR not yet opened
**Phase:** 04-data-auth

## Goal

Kerb prices like a real UK insurer. The prices come from figures we can cite, not from numbers made up for the demo.

- **A real vehicle catalogue.** About 40 of the cars people in the UK actually drive, plus a few performance and prestige cars. It is organised make → model → year → variant and uses real trim names. Each variant has its published insurance group and a believable value for its year.
- **Rating tables v1 for car, home and business**, each stored as a row in `rating_versions` and set `active`. They hold the base rates, rating factors, cover tiers, excesses, add-on prices, minimum and maximum premiums, IPT, and the thresholds that refer or decline a quote.
- **Calibrated against the market.** A typical driver, home or small business gets a price close to what UK comparison sites show for that profile today. The spread is realistic too: a 19-year-old in east London pays several times what a retired driver in Devon pays.
- **Loaded the same way everywhere.** Each deploy runs an upsert straight after the migrations. It can run any number of times and refuses to change a rating version once it's in the database.

5.4's `priceQuote()` and eligibility rules read these tables. 4.8 doesn't price anything itself.

## Decisions

1. **As realistic as possible** (Damion, 8 Nov 2026). It's a demo, but the numbers should hold up to someone who knows UK insurance. Damion has no real quotes of his own to calibrate against, so the numbers come from the public sources listed under Sources.
2. **A car that isn't in the catalogue gets a friendly message** (Damion, 8 Nov 2026). It says Kerb is a demo with a limited list of cars, suggests picking another car, and gives an email link for asking for a make to be added. This is 5.2's picker UI, so it goes into 5.2's row. 4.8 only supplies the list.
3. **Performance and prestige cars are included, so the demo can refer and decline** (Damion, 8 Nov 2026). A 911 or an M3 behaves the way it would with a real insurer: referred to a person, or declined for a young driver.
4. **Business is rated properly now, not left as a stub** (Damion, 8 Nov 2026). It has real trade classes, turnover and employee bands, public liability limits, compulsory employers' liability, and optional cover sections priced separately. This serves 4.9's seed data and the later business journey.

## Calls I've made (check these)

5. **Calibration targets sit between the "premium paid" and "quoted" figures.** The ABI measures what customers actually paid (car £566, combined home £389). Comparison sites measure quotes for new policies (car £517–£713, home about £200). Kerb is an online insurer selling new policies, so a typical profile should land in the overlap: about £450–£650 for car and £250–£400 for combined home. The example people (call 22) pin this down.
6. **Insurance groups 1–50, not Thatcham's new Vehicle Risk Rating.** Model ranges launched since 1 August 2024 get a 1–99 VRR score, but the two systems run side by side and the 1–50 group is still published for current cars. `vehicles.insurance_group` is already 1–50 (4.2). Where a newer car has only a VRR score, its group is estimated from the published group of the closest equivalent trim, and the source file says so in a comment. Switching to VRR is a later rating version, not 4.8.
7. **Values are worked out, not copied.** Each variant's new price (from manufacturer price lists, via Parkers or What Car?) is multiplied by a depreciation curve for its age. Real used-car prices vary too much to copy row by row. Values are fixed at a valuation date of **1 Nov 2026**, so they don't drift as time passes. There are three curves:

   | Age (years) | 0 | 1 | 2 | 3 | 4 | 5 | each later year | floor |
   |---|---|---|---|---|---|---|---|---|
   | Standard | 0.92 | 0.78 | 0.66 | 0.57 | 0.50 | 0.44 | × 0.90 | £1,000 |
   | Electric | 0.88 | 0.68 | 0.55 | 0.46 | 0.40 | 0.35 | × 0.90 | £1,000 |
   | Prestige (911, Range Rover Sport, M3, RS 3, AMG) | 0.94 | 0.84 | 0.76 | 0.70 | 0.65 | 0.60 | × 0.93 | £5,000 |

   Age is `2026 − year`. Values are rounded to the nearest £50.
8. **The catalogue is not versioned; rating tables are.** A catalogue row can be corrected in place, for example when a group changes. That never changes a quote, because a quote's `vehicles` row keeps its own copy of the details (4.2) and now also points at the catalogue row (`catalogue_variant_id`). A row is never deleted. A variant removed from the source gets `is_active = false`, which keeps it out of the picker but keeps old links working.
9. **Rating versions are immutable once in the database.** Each version stores a `content_hash`, a SHA-256 of its tables in canonical JSON. When the upsert finds a version already present:
   - **Same hash:** it does nothing.
   - **Different hash:** it fails the build, naming the product and version. The fix is a new version, never an edit, which is how a real insurer keeps every issued quote explainable.
10. **One generic set of rating tables, not one table per factor.** There are five tables per version: parameters, tiers, add-ons, factor bands and lookups. A new factor in v2 is new rows, not a migration. It's also the shape Databricks wants: one fact-like table of multipliers, joined by version.
11. **Lookups then bands, for the three long lists.** Postcode areas, occupations and trades each map to a band first (`LS` → band 5, teacher → B, roofer → E), and each band then has a multiplier. A real pricing team works this way, and it keeps the lists readable when the analysis is done (pricing by band, not by 121 separate areas).
12. **Numeric factors carry their ranges in the data.** Age, no-claims years, mileage and similar factors store `range_from` and `range_to` (both inclusive, whole numbers, `range_to` null meaning "and above"). That way a v2 can move a boundary without a code change. The source validation refuses gaps and overlaps.
13. **Postcode risk is per postcode area, separately for each product.**
    - **Coverage:** all 121 UK postcode areas, Northern Ireland's BT included.
    - **Crown dependencies:** Jersey, Guernsey and the Isle of Man (`JE`, `GY`, `IM`) aren't listed. They are separate insurance markets, so 5.4 declines them as "outside our cover area".
    - **Car:** one band per area (accidents and theft).
    - **Home:** two bands per area: buildings (flood, subsidence, storm) and contents (burglary).
    - **Business:** one band per area, taken from home's contents band (theft and damage).
    - **Bands:** 1 to 10, so ten multipliers per factor.
    - **Honest framing:** the bands are Kerb's estimates built from public data (call 23). They are not any insurer's actual rates, and a code comment in the source says so.
14. **No admin fees.** Many UK direct insurers no longer charge set-up fees. `fees_pence` stays in the formula (4.2) with `fee_pence = 0` in each v1, and the 5.5 breakdown can show "No admin fees". A later version can set a fee without a code change.
15. **Paying monthly costs more, as it does in the UK.** `monthly_credit_charge_rate = 0.10`, so 12 instalments add 10% to the annual price. Showing a representative APR is 5.5's job.
16. **Minimum and maximum premiums are before IPT.**
    - **Below the minimum:** the price is raised to the minimum.
    - **Above the maximum:** the quote is referred with the reason `premium_above_max`. Real insurers send unusually large risks to a person rather than quoting them automatically.
17. **Referral and decline thresholds are numbers in the rating version.** 5.4's eligibility functions read them, so a v2 can tighten or loosen them. The rule types are fixed in code; only the numbers are data.
18. **The application can only read the reference tables.** The migration revokes `INSERT`, `UPDATE` and `DELETE` on the six new tables from `kerb_app` (the 4.5b default grants give all four). The upsert runs as the owner on `DATABASE_URL_UNPOOLED`, like the migrations, and `vp run db:check-app-role` checks the revokes. `rating_versions` keeps its current grants because the integration factories insert draft versions as `kerb_app`.
19. **Caching.**
    - **Rating tables:** memoised in module scope, keyed by rating version id. A version never changes (call 9), so the cache can't go stale.
    - **Catalogue:** loaded whole (about 3,000 small rows) once per function instance. It only changes in a deploy, and a deploy starts new instances.
    - **Active version:** "which version is active for car" is one indexed query, not cached, so activating a v2 takes effect at once.
20. **The source of truth is typed TypeScript in the repo, reviewed like code.** The files are `src/server/reference/catalogue/*.ts` (one file per make, listing model generations with their variants, production years, new price, group, fuel, doors, engine, power, transmission and curve) and `src/server/reference/rating/{car,home,business}-v1.ts`. Zod validates both before anything is written. The expansion from generations to catalogue rows is a pure function.
21. **Bundles get 8% off.** `bundle_discount_rate = 0.08` is in the car and home versions. Comparison sites and insurers advertise 5–10% for car + home bundles. 5.4 decides how the discount is split across a bundle's items.
22. **Example people pin the calibration down.** The table below (in Rating tables v1) lists ten example people with the range my research says each should land in, and a hand calculation using the v1 numbers. They go into `src/server/reference/rating/calibration.ts`, and 5.4's tests price each one and check it lands in range. If a range is missed there, 5.4 adds a v2 rather than editing v1, unless v1 has never been deployed.
23. **How the postcode bands are built.** The builder writes a one-line reason per area in the source file.
    - **Car:** start from the Confused.com Q3 2026 regional averages divided by the £713 UK average, mapped to the nearest band. Then adjust cities using MoneySuperMarket's Q3 2026 town medians: Bradford, Oldham, Birmingham, Manchester and east London up; Harrogate, Exeter, Dorchester and Llandrindod Wells down.
    - **Home buildings:** the share of homes at flood risk (Environment Agency, SEPA, Natural Resources Wales) and shrink-swell clay subsidence risk (BGS GeoSure), so London and the South East's clay and the Severn, Ouse and Calder valleys go up.
    - **Home contents:** police.uk burglary rates by police force area.

## Vehicle catalogue

### Table `vehicle_catalogue` (one variant in one model year)

| Column | Notes |
|---|---|
| `id` | `uuid` (uuidv7) |
| `make`, `model`, `variant` | text, as shown in the picker (`Ford`, `Fiesta`, `1.0 EcoBoost Titanium 5dr`) |
| `year` | `smallint`, the model year |
| `body_style` | `hatchback` / `saloon` / `estate` / `suv` / `coupe` / `convertible` / `mpv` |
| `fuel_type` | the 4.2 set: `petrol` / `diesel` / `hybrid` / `electric` |
| `transmission` | `manual` / `automatic` |
| `doors` | 2–7 |
| `engine_cc` | nullable (null for electric) |
| `power_bhp` | `> 0` |
| `insurance_group` | 1–50 |
| `value_pence` | `> 0`, from call 7 |
| `is_active` | default true (call 8) |
| `created_at`, `updated_at` | |

Unique `(make, model, year, variant)`, which is also the upsert key, so ids never change. Indexed on `(make, model, year)` for the picker cascade.

`vehicles` gains `catalogue_variant_id`. It's nullable, because a quote can be entered by hand in future and the seed may leave it empty. It's a foreign key to `vehicle_catalogue` with `RESTRICT` and an index.

### What's in it

- **Years:** 2012 to 2026, only for the years each variant was actually sold.
- **Variants:** three to five real trims per model and generation, covering the engine and trim mix people actually buy.
- **Size:** 1,546 rows across 43 models (built 8 Nov 2026; the first estimate was 2,000–3,000).

**Everyday models (41).** Chosen from SMMT's 2025 best-sellers and the DVLA/SMMT list of the most common cars on the road:

| Make | Models |
|---|---|
| Ford | Fiesta (to 2023), Focus (to 2025), Puma (2020–), Kuga |
| Vauxhall | Corsa, Astra, Mokka (2021–) |
| Volkswagen | Golf, Polo, T-Roc (2018–), Tiguan, ID.3 (2020–) |
| Nissan | Qashqai, Juke, Micra (to 2023), Leaf |
| Toyota | Yaris, Corolla (2019–), C-HR (2017–) |
| Kia | Sportage, Niro (2017–), Picanto |
| Hyundai | Tucson (2015–), i10, Kona (2017–) |
| Peugeot | 208, 2008 (2013–), 3008 |
| MG | HS (2019–), ZS (2017–), MG4 (2022–) |
| BMW | 1 Series, 3 Series |
| Mercedes-Benz | A-Class |
| Audi | A3 |
| MINI | Hatch |
| Skoda | Octavia |
| Renault | Clio |
| Dacia | Sandero |
| Tesla | Model 3 (2019–), Model Y (2022–) |

**Performance and prestige (decision 3).** These make the referral and decline rules visible:

| Model | Variants |
|---|---|
| New models | Porsche 911 (Carrera, Carrera S), Range Rover Sport |
| Performance trims of models above | BMW M3 (3 Series), Mercedes-AMG A 45 S (A-Class), Audi RS 3 (A3), Volkswagen Golf R and Golf GTI, Ford Focus ST and Fiesta ST, Tesla Model 3 Performance |

**Where the groups come from:** the published group per variant, from Parkers, Honest John, What Car? or a comparison site's group checker, with the source noted per generation in the file. Call 6 covers cars that have only a VRR score.

## Rating tables v1

### Tables (all per `rating_version_id`, `CASCADE`, so a draft version can be removed with its rows)

| Table | Columns | Key |
|---|---|---|
| `rating_parameters` | `name`, `value` (`numeric(14,4)`: room for £5m in pence) | `(rating_version_id, name)` |
| `rating_tiers` | `cover_level`, `multiplier` (`numeric(8,4)`, `> 0`), `compulsory_excess_pence` (`≥ 0`) | `(rating_version_id, cover_level)` |
| `rating_addons` | `addon`, `annual_price_pence` (`> 0`), `factors` (`text[]`, the factor names that multiply its price; empty means a flat price), `available_to_groups` (`text[]`, nullable; lookup groups that can buy it, null means everyone) | `(rating_version_id, addon)` |
| `rating_factors` | `factor`, `band`, `range_from`, `range_to` (nullable `bigint`, call 12; turnover ranges are in pence), `multiplier` (`numeric(8,4)`, `> 0`) | `(rating_version_id, factor, band)` |
| `rating_lookups` | `lookup` (`postcode_area` / `occupation` / `trade`), `factor` (which band factor it feeds, e.g. `buildings_postcode_band`), `key`, `label`, `group` (nullable: region, trade group), `band` | `(rating_version_id, factor, key)` |

`rating_versions` gains `content_hash` (text, nullable for the factory's draft versions).

Every v1 row has `status = 'active'`, `effective_from = 2026-11-01` and `notes` naming the sources.

### Car v1

**Formula, for 5.4.** Comprehensive annual premium before IPT = `base_rate` × every factor × tier multiplier. It's clamped to the minimum and maximum (call 16), and IPT is added on the rounded premium.

**Parameters**

| Name | Value |
|---|---|
| `base_rate_pence` | 46000 |
| `min_premium_pence` | 22500 |
| `max_premium_pence` | 600000 |
| `ipt_rate` | 0.12 |
| `fee_pence` | 0 |
| `monthly_credit_charge_rate` | 0.10 |
| `bundle_discount_rate` | 0.08 |
| `young_driver_excess_pence` (compulsory, added for any driver under 25) | 25000 |

**Eligibility thresholds (call 17)**

| Name | Value |
|---|---|
| `refer_insurance_group_min` | 45 |
| `refer_value_pence_min` | 7500000 |
| `decline_value_pence_min` | 15000000 |
| `decline_young_age_max` / `decline_young_group_min` (under 21, group 30+) | 20 / 30 |
| `decline_under25_group_min` (under 25, group 40+) | 40 |
| `refer_past_claims_min` | 3 |
| `refer_new_licence_years_max` / `refer_new_licence_group_min` (licence under 1 year, group 25+) | 0 / 25 |
| `refer_age_min` | 80 |

**Tiers**

| Tier | Multiplier | Compulsory excess |
|---|---|---|
| Essential (third party, fire and theft) | 0.96 | £250 |
| Comprehensive | 1.00 | £250 |
| Plus (comprehensive + courtesy car, windscreen with no excess) | 1.18 | £150 |

Essential is only slightly cheaper on purpose. In the UK, third party, fire and theft is often no cheaper than comprehensive, because riskier drivers tend to choose it.

**Add-ons**

| Add-on | Annual price | Pricing |
|---|---|---|
| UK breakdown (`breakdown_uk`) | £45 | flat |
| Motor legal (`motor_legal`) | £25 | flat |

**Factors.** Each table gives the multiplier for each band or range.

`driver_age` (main driver):

| Age | 17–18 | 19–20 | 21–24 | 25–29 | 30–39 | 40–49 | 50–59 | 60–69 | 70–74 | 75–79 | 80+ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Multiplier | 2.40 | 2.00 | 1.50 | 1.20 | 1.06 | 1.00 | 0.90 | 0.84 | 0.90 | 1.02 | 1.25 |

`no_claims_years`:

| Years | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9+ |
|---|---|---|---|---|---|---|---|---|---|---|
| Multiplier | 1.50 | 1.35 | 1.25 | 1.16 | 1.09 | 1.05 | 1.03 | 1.02 | 1.01 | 1.00 |

`licence_years`:

| Years | 0 | 1–2 | 3–4 | 5+ |
|---|---|---|---|---|
| Multiplier | 1.25 | 1.12 | 1.05 | 1.00 |

`insurance_group`: one row per group 1–50, with multiplier `1.022^(group − 15)` rounded to 4 places. Group 1 is 0.7374, group 15 is 1.0000 and group 50 is 2.1418.

`annual_mileage`:

| Miles | up to 5,000 | 5,001–10,000 | 10,001–15,000 | 15,001–20,000 | 20,001–30,000 | 30,001+ |
|---|---|---|---|---|---|---|
| Multiplier | 0.95 | 1.00 | 1.04 | 1.08 | 1.15 | 1.25 |

Other single-choice factors:

| Factor | Bands |
|---|---|
| `usage` | social 0.95, commuting 1.00, business 1.12 |
| `overnight_location` | garage 0.95, driveway 0.97, street 1.08 |
| `fuel_type` | petrol 1.00, diesel 1.02, hybrid 1.03, electric 1.08 (EV repairs cost more) |

`vehicle_age`:

| Years | 0–2 | 3–7 | 8–12 | 13+ |
|---|---|---|---|---|
| Multiplier | 1.04 | 1.00 | 0.97 | 1.00 |

`past_claims` (last 5 years):

| Claims | 0 | 1 | 2 | 3+ |
|---|---|---|---|---|
| Multiplier | 1.00 | 1.30 | 1.65 | 1.65 (referred anyway) |

`voluntary_excess`:

| Voluntary excess | £0 | £100 | £250 | £500 | £750 | £1,000 |
|---|---|---|---|---|---|---|
| Multiplier | 1.00 | 0.98 | 0.95 | 0.91 | 0.89 | 0.87 |

`named_driver_age` (each additional driver):

| Age | 17–20 | 21–24 | 25–29 | 30–74 | 75+ |
|---|---|---|---|---|---|
| Multiplier | 1.35 | 1.18 | 1.05 | 0.97 | 1.05 |

A named driver aged 30–74 brings a small discount, as an experienced second driver does in the UK.

`occupation_band` (via the `occupation` lookup): A 0.92, B 0.95, C 1.00, D 1.08, E 1.18. The occupation list is below.

`postcode_band` (via the `postcode_area` lookup):

| Band | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Multiplier | 0.85 | 0.90 | 0.95 | 1.00 | 1.07 | 1.15 | 1.25 | 1.38 | 1.55 | 1.75 |

The other postcode band factors use the same ten multipliers.

**Occupations.** These are the 5.3 dropdown. They replace "the list is checked by Zod" in 4.2 with this data, and each key is the stored `drivers.occupation`.

| Band | Occupations |
|---|---|
| A | retired, police officer, civil servant, accountant, engineer, software developer, pharmacist, librarian, architect, nurse |
| B | teacher, office manager, administrator, solicitor, dentist, receptionist, project manager, social worker, firefighter, paramedic, HGV driver |
| C | doctor, sales assistant, electrician, plumber, carpenter, mechanic, hairdresser, builder, farmer, homemaker, self-employed (other) |
| D | student, chef, warehouse operative, healthcare assistant, care worker, bar staff, delivery driver, apprentice, labourer, sales representative |
| E | unemployed, taxi driver, musician, entertainer, professional sportsperson |

The bands follow the 2025–26 occupation studies cited by MoneySuperMarket, Quotezone and Honest John: warehouse workers, healthcare assistants and chefs near the top; retired drivers, civil servants and police near the bottom. Occupation is a lawful and standard UK rating factor. Nothing in any v1 table uses gender (banned since 2012), ethnicity, religion, disability or any other protected characteristic. Age is allowed for insurance under the Equality Act 2010 exemption, and is used with actuarial backing.

### Home v1 (combined buildings and contents)

**Formula, for 5.4.**
- Buildings section = rebuild cost ÷ £1,000 × `buildings_rate_pence` × the buildings factors.
- Contents section = contents value ÷ £1,000 × `contents_rate_pence` × the contents factors.
- The two are added, then multiplied by the tier multiplier and clamped.

**Parameters**

| Name | Value |
|---|---|
| `buildings_rate_pence` (per £1,000 rebuild) | 75 |
| `contents_rate_pence` (per £1,000 contents) | 190 |
| `min_premium_pence` | 12000 |
| `max_premium_pence` | 500000 |
| `ipt_rate` | 0.12 |
| `fee_pence` | 0 |
| `monthly_credit_charge_rate` | 0.10 |
| `bundle_discount_rate` | 0.08 |
| `escape_of_water_excess_pence` (shown in cover content) | 35000 |
| `subsidence_excess_pence` (shown in cover content) | 100000 |

**Thresholds**

| Name | Value |
|---|---|
| `refer_rebuild_pence_min` | 100000000 |
| `decline_rebuild_pence_min` | 250000000 |
| `refer_contents_pence_min` | 15000000 |
| `refer_year_built_max` (built before 1750) | 1749 |
| `refer_past_claims_min` | 3 |

**Tiers**

| Tier | Multiplier | Compulsory excess |
|---|---|---|
| Essential (no accidental damage) | 0.90 | £100 |
| Comprehensive (accidental damage to buildings) | 1.00 | £100 |
| Plus (accidental damage to contents too, higher limits) | 1.20 | £50 |

**Add-ons** (all flat)

| Add-on | Annual price |
|---|---|
| `home_emergency` | £72 |
| `legal_expenses` | £30 |
| `personal_possessions` (£2,500 unspecified, away from home) | £48 |

**Buildings factors**

`property_type`: detached 1.05, semi 1.00, terraced 0.97, bungalow 0.95, flat 0.85 (the freeholder usually insures a block's structure).

`year_built`:

| Built | before 1900 | 1900–1945 | 1946–1979 | 1980–1999 | 2000+ |
|---|---|---|---|---|---|
| Multiplier | 1.25 | 1.12 | 1.03 | 1.00 | 0.95 |

`buildings_postcode_band`: bands 1–10, as for car.

**Contents factors**

| Factor | Bands |
|---|---|
| `contents_postcode_band` | bands 1–10, as for car |
| `burglar_alarm` | yes 0.95, no 1.00 |
| `lock_type` | standard 1.05, five_lever 0.95, multipoint 0.95 |
| `smoke_alarm` | yes 1.00, no 1.05 |

`bedrooms`:

| Bedrooms | 0–2 | 3 | 4 | 5+ |
|---|---|---|---|---|
| Multiplier | 0.95 | 1.00 | 1.06 | 1.12 |

**Applied to both sections:** `past_claims` (last 5 years): 0 → 1.00, 1 → 1.20, 2 → 1.45, 3+ → referred.

### Business v1

**Formula, for 5.4.**
- Public liability (PL) = `pl_rate_pence_<band>` for the trade's band × the turnover band × the postcode band.
- Employers' liability (EL) = employees × `el_rate_pence_<band>`.
- The two are added, then multiplied by the tier multiplier and clamped. Optional sections are add-ons.
- EL is required by law when there are employees (Employers' Liability (Compulsory Insurance) Act 1969), with a £10m limit, so it's included automatically, never offered as an option.

**Tiers set the public liability limit**

| Tier | PL limit | Multiplier | Compulsory excess |
|---|---|---|---|
| Essential | £1m | 1.00 | £250 |
| Comprehensive | £2m | 1.15 | £250 |
| Plus | £5m | 1.40 | £100 |

**Parameters**

| Name | Value |
|---|---|
| `min_premium_pence` | 5500 |
| `max_premium_pence` | 2000000 |
| `ipt_rate` | 0.12 |
| `fee_pence` | 0 |
| `monthly_credit_charge_rate` | 0.10 |
| `bundle_discount_rate` | 0.08 |

**Thresholds**

| Name | Value |
|---|---|
| `refer_turnover_pence_min` (over £5m) | 500000000 |
| `refer_employees_min` | 51 |
| `refer_high_risk_employees_min` (band E trades with more than 10 employees) | 11 |

**Rates by trade band.** These are pounds, not multipliers, so they're parameters: `pl_rate_pence_a` … `pl_rate_pence_e` (PL at £1m) and `el_rate_pence_a` … `el_rate_pence_e` (EL per employee). The `trade` lookup's band picks which one applies.

| Band | A | B | C | D | E |
|---|---|---|---|---|---|
| PL at £1m | £60 | £85 | £115 | £170 | £260 |
| EL per employee | £45 | £80 | £150 | £210 | £300 |

**`turnover_band`**

| Turnover | up to £50k | £50k–100k | £100k–250k | £250k–500k | £500k–1m | £1m–2.5m | £2.5m–5m |
|---|---|---|---|---|---|---|---|
| Multiplier | 0.85 | 1.00 | 1.20 | 1.45 | 1.80 | 2.40 | 3.20 |

**`postcode_band`:** bands 1–10, as for car, with each area's band copied from home's contents band (call 13).

**Trades (30).** The `trade` lookup gives each a group and band, and each key is the stored `businesses.trade_class`.

| Group | Trades (band) |
|---|---|
| Office and professional | accountant (A), IT consultant (A), management consultant (A), marketing consultant (A), graphic designer (A), architect (B) |
| Retail | clothing shop (B), convenience store (B), florist (B), bookshop (B) |
| Food and hospitality | café (C), restaurant (C), mobile caterer (C), takeaway (D), pub (D) |
| Hair, beauty and wellbeing | hairdresser (B), barber (B), beauty therapist (B), personal trainer (B), dog groomer (B) |
| Trades and construction | cleaner (B), electrician (C), plumber (C), painter and decorator (C), carpenter (C), gardener (C), plasterer (C), builder (D), roofer (E), scaffolder (E) |

A "good chunk" (decision 4); the rest wait for the business journey. Keys are snake_case (`it_consultant`), as are occupation keys (`hgv_driver`).

**Add-ons (optional cover sections).** In v1 the sums insured are fixed in the cover content: contents and stock £10,000, tools £2,500, business interruption up to £100,000 gross profit, professional indemnity £250,000.

| Add-on | Annual price | Multiplied by | Available to |
|---|---|---|---|
| `contents_stock` | £95 | `postcode_band` | everyone |
| `tools` | £120 | none | trades and construction |
| `business_interruption` | £60 | `turnover_band` | everyone |
| `professional_indemnity` | £180 | `turnover_band` | office and professional |
| `legal_expenses` | £45 | none | everyone |

`businesses.cover_sections` records the chosen sections, which are the selected add-ons. 5.x keeps the two in step.

### Example people (call 22)

Prices include IPT. The hand calculations use the v1 numbers above. "Target" is the range the research supports.

| # | Who | Hand calculation | Lands at | Target |
|---|---|---|---|---|
| C1 | Priya, 45, teacher (B), Leeds `LS` (band 5), 2019 Focus 1.0 EcoBoost Titanium (group 14), 12 years no claims, 8,000 miles, commuting, driveway, £250 voluntary excess, Comprehensive | 460 × 1.00 × 1.07 × 0.95 × 0.9785 × 0.97 × 0.95 = £421.6 | **£472** | £420–£650 |
| C2 | Jordan, 19, student (D), Hackney `E` (band 9), 2018 Fiesta 1.1 Zetec (group 5, published), 0 no claims, licence 1 year, 6,000 miles, social, street, no voluntary excess | 460 × 2.00 × 1.55 × 1.08 × 0.8044 × 1.50 × 1.12 × 0.95 × 1.08 × 0.97 = £2,071 | **£2,320** | £1,900–£2,600 |
| C3 | Margaret, 67, retired (A), Exeter `EX` (band 2), 2016 Yaris 1.33 Icon (group 10, published), 15 years no claims, 4,000 miles, social, garage, £250 voluntary excess | 460 × 0.84 × 0.90 × 0.92 × 0.8969 × 0.95 × 0.95 × 0.95 × 0.95 × 0.97 = £226.7 | **£254** (just above the £225 minimum) | £250–£400 |
| C4 | Dev, 35, software developer (A), Bristol `BS` (band 5), 2025 Tesla Model Y Long Range RWD (group 39 after Thatcham's 2025 reassessment), 8 years no claims, 12,000 miles, commuting, driveway, £250 voluntary excess | 460 × 1.06 × 1.07 × 0.92 × 1.6859 × 1.08 × 1.01 × 1.04 × 0.97 × 0.95 × 1.04 (vehicle age 1) = £879.8 | **£985** | £800–£1,300 |
| C5 | Alex, 22, Manchester, 2021 BMW M3 Competition (group 50) | under 25 and group 40+ | **declined** | declined |
| C6 | Sam, 52, Guildford, 2020 Porsche 911 Carrera S PDK (group 50) | group 45+ | **referred** | referred |
| H1 | 3-bed semi in Leeds, built 1965, rebuild £240k, contents £45k, multipoint locks, smoke alarm, no burglar alarm, Comprehensive; buildings band 4, contents band 6 | buildings 240 × 0.75 × 1.03 = £185.4; contents 45 × 1.90 × 1.15 × 0.95 = £93.4 | **£312** | £250–£400 |
| H2 | 2-bed flat in Hackney, built 1990, rebuild £150k, contents £30k, alarm, multipoint; buildings band 6, contents band 9 | buildings 150 × 0.75 × 0.85 × 1.15 = £110.0; contents 30 × 1.90 × 1.55 × 0.95 × 0.95 × 0.95 (alarm, multipoint, 2 bedrooms) = £75.7 | **£208** | £180–£320 |
| H3 | 4-bed detached near Shrewsbury, built 1890, rebuild £450k, contents £80k, standard locks; buildings band 7 (Severn flood), contents band 2 | buildings 450 × 0.75 × 1.05 × 1.25 × 1.25 = £553.7; contents 80 × 1.90 × 0.90 × 1.05 × 1.06 = £152.3 | **£790** | £600–£1,000 |
| B1 | Sole-trader electrician, Derby (band 4), turnover £60k, no employees, Essential | 115 × 1.00 × 1.00 | **£129** | £80–£180 (Simply Business shows from £80) |
| B2 | Mobile hairdresser, Nottingham (band 5), turnover £25k, no employees, Essential | 85 × 0.85 × 1.07 = £77.3 | **£87** | £70–£140 (Simply Business example £103) |
| B3 | Builder, Glasgow (band 6), turnover £300k, 2 employees, Comprehensive + tools | (170 × 1.45 × 1.15 + 2 × 210) × 1.15 + 120 = £929.0 | **£1,040** | £900–£1,500 (Simply Business example £1,239) |

The bands in these rows (Leeds 5, Hackney 9 for car, and so on) are targets for the band table, not extra data. If the band research puts an area elsewhere, the person's target range still has to hold, and the spec's number gets updated.

## In scope

### Schema (generated migration, plus a hand-written part)

- `vehicle_catalogue`, `rating_parameters`, `rating_tiers`, `rating_addons`, `rating_factors` and `rating_lookups`, with the checks above. Each has a data-contract entry (copied, every column `keep`, with no personal data) and a `record_delete` trigger.
- `vehicles.catalogue_variant_id` and `rating_versions.content_hash`, with their contract entries.
- **Hand-written:** revoke `INSERT`, `UPDATE` and `DELETE` on the six tables from `kerb_app` (call 18).

### Server

- **Source data:** `src/server/reference/catalogue/` (one file per make), `src/server/reference/rating/{car,home,business}-v1.ts`, `calibration.ts`. The Zod schemas validate the sources; `expandCatalogue()` turns generations into rows; `contentHash()` hashes a version.
- **Database access** in `src/server/data/reference.ts` (the 4.5 lint rule):
  - `upsertReferenceData(db)`: the catalogue and each version, in one transaction per product plus one for the catalogue.
  - Readers: `getCatalogue()` (memoised), `getRatingTables(ratingVersionId)` (memoised) and `getActiveRatingVersion(product)`.
- **The `db:reference` script** (`scripts/reference-data.ts`), runnable locally.
- **`db:deploy`** runs the upsert after a successful migrate, with the same targets and skip rules as the migrate. The comment in `db-deploy.ts` that promises this gets replaced by the real call.

### Docs

- `phase.md`: the 4.8 row and testing row; the 5.2 row gains decision 2's message; the 5.3 row notes the occupation list comes from `rating_lookups`.
- `engineering.md` §3 (the reference step in the deploy) and the server memory row.
- `build-plan.md`.

## Out of scope

| Item | Where it goes |
|---|---|
| `priceQuote()`, the eligibility functions, rounding, and how the bundle discount is spread | 5.4 |
| The catalogue API, its cache headers and the picker, including decision 2's message | 5.2 |
| The postcodes.io lookup and its `postcode_areas` cache. Its name is close to this slice's `postcode_area` lookup, but it's a different table | 5.2 |
| Cover feature lists, exclusions and the product information content | 5.5 (they're code, versioned with the rating version, per 4.2) |
| Moving to Thatcham's Vehicle Risk Rating | a later rating version (call 6) |
| A screen for staff to draft, activate or retire rating versions | not planned; versions arrive by deploy |
| Sums insured chosen by the customer for business sections | the business journey |
| Plate lookup demo plates | 5.2 |

## What you set up

- Nothing new in Vercel or Neon. The upsert uses the existing `DATABASE_URL_UNPOOLED`.
- **For 5.2, later:** check that `hello@kerb.opsedsolutions.com` receives mail (decision 2's link), or tell me which address to use.
- **Read the numbers** in Rating tables v1 before approving. They're my research, not advice from an actuary.

## Steps

- [x] You approve this spec
- [x] Migration: the six tables, the two new columns, the contract entries, the triggers and the revokes; `db:check-app-role` updated
- [x] Rating sources v1 (car, home, business) with their Zod validation and `contentHash()`
- [x] Postcode bands for all 121 areas, each with its one-line reason
- [x] Catalogue sources, make by make, with the groups and new prices sourced; `expandCatalogue()` and its tests
- [x] `upsertReferenceData`, the readers, the memo cache and their tests
- [x] `db:reference` and the `db:deploy` change
- [x] `calibration.ts` with the example people
- [x] Docs
- [x] `vp check`, `vp test`, `vp build`
- [ ] Staging: the build log shows the upsert; in Neon, `rating_versions` has three `active` v1 rows and `vehicle_catalogue` has its rows; a second deploy logs "no changes"

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | Source validation: every numeric factor covers 0 (or its minimum) to "and above" with no gap or overlap; every band named by a lookup has a multiplier; each postcode factor lists all 121 areas exactly once and no crown dependency; tiers are exactly the three; every multiplier `> 0`; every add-on's `factors` exist; a broken source (gap, unknown band, missing area) is refused with a message naming it | yes |
| Unit | `expandCatalogue()`: years only within a generation's production range; the curves give the hand-worked values for a standard, an electric and a prestige car (worked in a comment); the floors apply; no duplicate `(make, model, year, variant)`; every row has group 1–50, doors 2–7 and a value `> 0`; about 40 everyday models plus the performance list are present | yes |
| Unit | `contentHash()` is the same regardless of key order and changes when any multiplier changes; `planDeploy` still skips previews and local builds | yes |
| Integration | The upsert on an empty database inserts v1 for each product as `active`, with every row; a second run changes nothing (same ids, counts and `updated_at`); an edited v1 source fails with "car v1 … add v2" and writes nothing; a corrected catalogue group updates in place with the same id; a variant removed from the source becomes `is_active = false` | yes |
| Integration | As `kerb_app`: `SELECT` works and `INSERT`, `UPDATE` and `DELETE` on each reference table are refused; deleting a catalogue row a vehicle points at is refused; the contract and trigger checks from 4.2 cover the new tables | yes |
| Integration | `getRatingTables(id)` returns the same object for the same id and queries once; `getActiveRatingVersion("car")` returns v1; `getCatalogue()` queries once per instance | yes |

The factories keep making `draft` versions. Their version numbers start at 1000 so they never clash with the real v1 in the same database.

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] Staging's build log shows the upsert, and a redeploy shows no changes.
- [ ] Neon `dev` has three active v1 rating versions and the catalogue, and `vp run db:check-app-role` passes.
- [ ] Damion has read the v1 numbers and the example people.

## Commit message

`feat: vehicle catalogue of popular UK cars and rating tables v1 for car, home and business, calibrated to 2026 UK market prices and loaded on every deploy`

## Sources

**Plan:** `phase.md` 4.8 row and testing row; 4.2 decisions 6, 12, 13, 16, 17, 19 and the `vehicles`, `drivers`, `properties`, `businesses` and `quote_item_*` tables; 4.5 lint rule; 4.5b `kerb_app` grants; 5.2–5.5 rows; engineering.md §3 and the server memory row.

**Damion, 8 Nov 2026:** as realistic as possible; no real quotes to calibrate against; the not-in-catalogue message; performance cars included; business done properly now.

**Market data** (accessed 8 Nov 2026):

| Topic | Sources |
|---|---|
| Car premiums | [ABI, Q1 2026](https://www.abi.org.uk/media-hub/news-post/motor-premiums-remain-stable-but-cost-of-repairs-still-high); [ABI, Q2 2026](https://www.abi.org.uk/media-hub/news-post/record-32-billion-paid-out-to-support-motor-insurance-customers-in-q2-2026); [Confused.com price index Q3 2026](https://www.confused.com/car-insurance/price-index); [Quotezone by region and age, Q3 2026](https://www.quotezone.co.uk/car-insurance/average-car-insurance-premium-by-region); [MoneySuperMarket statistics](https://www.moneysupermarket.com/car-insurance/car-insurance-statistics/) and [locations, Q3 2026](https://www.moneysupermarket.com/car-insurance/least-and-most-expensive-locations/) |
| Occupations | [Honest John](https://www.honestjohn.co.uk/news/tax-insurance-and-warranties/2025-07/worst-jobs-for-car-insurance-revealed); [Insurance Business](https://insurancebusinessmag.com/uk/news/breaking-news/ten-most-and-least-expensive-job-titles-for-car-insurance-312636.aspx) |
| Insurance groups and VRR | [Auto Express](https://www.autoexpress.co.uk/consumer-news/364426/uk-car-insurance-groups-axed-new-vehicle-risk-ratings); [Quotezone groups](https://www.quotezone.co.uk/car-insurance/groups) |
| Popular cars | [Car Dealer Magazine on SMMT parc data](https://cardealermagazine.co.uk/british-motor-parc-grew-to-record-levels-in-2024-as-fiesta-remained-most-common-car-smmt/314319); [carwow, best sellers 2025](https://www.carwow.co.uk/news/10086/best-selling-cars-2025); [DVLA licensing statistics 2025](https://www.gov.uk/government/statistics/vehicle-licensing-statistics-2025/vehicle-licensing-statistics-united-kingdom-2025) |
| Home | [Selectra on the ABI tracker, Q2–Q3 2026](https://selectra.co.uk/insurance/news/home-insurance-premiums-turn-back-up-abi-tracker); [Insurance Times, previously flooded homes](https://www.insurancetimes.co.uk/news/previously-flooded-homeowners-paying-121-more-for-cover/1458142.article) |
| Business | [Simply Business](https://www.simplybusiness.co.uk/insurance/faq/how-much-does-business-insurance-cost); [PolicyBee](https://www.policybee.co.uk/blog/business-insurance-statistics); [MoneySuperMarket business report](https://www.moneysupermarket.com/business-insurance/business-insurance-report/) |
| IPT | [Insurance Insider](https://www.insuranceinsider.com/article/2876fhy9ajjsuvqilrxyj/autumn-budget-uk-ipt-to-remain-at-12) |
| Postcode-band inputs (used when building them) | Environment Agency flood risk, BGS GeoSure, police.uk crime data |
