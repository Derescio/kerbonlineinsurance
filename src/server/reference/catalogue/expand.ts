import { type CatalogueRow, type Curve, type MakeSource, makeSourceSchema } from "./types";

// Generations → one catalogue row per variant per model year (4.8, calls 7 and 20). Pure, so the
// deploy's upsert and the tests expand the same rows.

/** Values are fixed at 1 Nov 2026 (call 7), so they don't drift: age = 2026 − year. */
export const VALUATION_YEAR = 2026;
export const FIRST_YEAR = 2012;

// Share of the new price kept at ages 0–5, then the yearly factor after that, then the floor
const CURVES: Record<Curve, { ages: readonly number[]; later: number; floorPence: number }> = {
  standard: { ages: [0.92, 0.78, 0.66, 0.57, 0.5, 0.44], later: 0.9, floorPence: 100_000 },
  electric: { ages: [0.88, 0.68, 0.55, 0.46, 0.4, 0.35], later: 0.9, floorPence: 100_000 },
  prestige: { ages: [0.94, 0.84, 0.76, 0.7, 0.65, 0.6], later: 0.93, floorPence: 500_000 },
};

export class CatalogueError extends Error {
  override name = "CatalogueError";
}

/** The car's value in pence at the valuation date: new price × curve, to the nearest £50, floored. */
export function valuePence(newPricePence: number, year: number, curve: Curve): number {
  const { ages, later, floorPence } = CURVES[curve];
  const age = VALUATION_YEAR - year;
  const last = ages.length - 1;
  const share = age <= last ? ages[age]! : ages[last]! * later ** (age - last);
  const rounded = Math.round((newPricePence * share) / 5_000) * 5_000;
  return Math.max(rounded, floorPence);
}

export function expandCatalogue(makes: readonly MakeSource[]): CatalogueRow[] {
  const rows: CatalogueRow[] = [];
  const seen = new Set<string>();

  for (const source of makes) {
    const parsed = makeSourceSchema.safeParse(source);
    if (!parsed.success) {
      throw new CatalogueError(`${source.make}: ${parsed.error.issues[0]!.message}`);
    }
    for (const generation of parsed.data.generations) {
      const where = `${source.make} ${generation.model}`;
      for (const variant of generation.variants) {
        const name = `${where} ${variant.name}`;
        if ((variant.fuelType === "electric") !== (variant.engineCc === null)) {
          throw new CatalogueError(`${name}: engineCc must be null exactly when electric`);
        }
        const [from, to] = variant.years ?? generation.years;
        if (from < FIRST_YEAR || to > VALUATION_YEAR || from > to) {
          throw new CatalogueError(
            `${name}: years ${from}–${to} outside ${FIRST_YEAR}–${VALUATION_YEAR}`,
          );
        }
        const [genFrom, genTo] = generation.years;
        if (from < genFrom || to > genTo) {
          throw new CatalogueError(`${name}: years ${from}–${to} outside its generation`);
        }
        for (let year = from; year <= to; year++) {
          const key = `${name} ${year}`;
          if (seen.has(key)) throw new CatalogueError(`${key} is listed twice`);
          seen.add(key);
          rows.push({
            make: source.make,
            model: generation.model,
            year,
            variant: variant.name,
            bodyStyle: generation.bodyStyle,
            fuelType: variant.fuelType,
            transmission: variant.transmission,
            doors: variant.doors,
            engineCc: variant.engineCc,
            powerBhp: variant.powerBhp,
            insuranceGroup: variant.insuranceGroup,
            valuePence: valuePence(variant.newPricePence, year, generation.curve),
          });
        }
      }
    }
  }
  return rows;
}
