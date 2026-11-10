import type { PickerCar } from "#/features/quote/catalogue";
import { getCatalogue, type CatalogueRecord } from "#/server/data/reference";

// GET /api/catalogue (5.2, call 13). The catalogue only changes in a deploy, and a Vercel deploy
// starts with an empty CDN cache, so the CDN keeps it for a year; browsers recheck hourly. Not
// publicCacheHeaders(): that's the landing's five-minute setting (engineering.md §5).

export const CATALOGUE_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400";

/** What the picker needs. Value and insurance group stay on the server. */
function pickerCar(record: CatalogueRecord): PickerCar {
  return {
    id: record.id,
    make: record.make,
    model: record.model,
    year: record.year,
    variant: record.variant,
    fuelType: record.fuelType,
    doors: record.doors,
    transmission: record.transmission,
  };
}

/** A failure is a 503 with no-store, so the CDN never keeps it for a year (plan P3) */
export async function catalogueResponse(
  load: () => Promise<readonly CatalogueRecord[]> = () => getCatalogue(),
): Promise<Response> {
  try {
    const cars = (await load()).map(pickerCar);
    return Response.json({ cars }, { headers: { "Cache-Control": CATALOGUE_CACHE_CONTROL } });
  } catch (error) {
    console.error("catalogue: load failed", error);
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
