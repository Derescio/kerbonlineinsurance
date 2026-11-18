import { choices, listLookups } from "./build";
import { homeV1 } from "./home-v1";
import { OCCUPATION_BANDS } from "./occupations";
import type { RatingSource } from "./types";

// Home rating v2 (5.7c, decision 4): v1 plus the policyholder's occupation, read through car's
// occupation bands and weighted lightly, as home insurers do. It multiplies the whole premium.
// Band C is 1, so the reference homes H1–H3 keep v1's price. Never edit once deployed.

export const homeV2: RatingSource = {
  ...homeV1,
  version: 2,
  effectiveFrom: "2026-11-18",
  notes:
    "v2 (5.7c): v1 plus an occupation factor on car's occupation bands; see plan/phases/05-quote/07c-stored-answers.md",
  factors: [
    ...homeV1.factors,
    ...choices("occupation_band", { A: 0.95, B: 0.97, C: 1, D: 1.03, E: 1.06 }),
  ],
  lookups: [...homeV1.lookups, ...listLookups("occupation", "occupation_band", OCCUPATION_BANDS)],
};
