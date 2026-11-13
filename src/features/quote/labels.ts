import type { CoverLevel } from "#/server/db/schema/values";

import { TIERS } from "./cover";

/** A cover level's name ("Comprehensive"), or "Car insurance" when none is chosen */
export const tierName = (coverLevel: string | null) =>
  coverLevel && coverLevel in TIERS ? TIERS[coverLevel as CoverLevel].name : "Car insurance";
