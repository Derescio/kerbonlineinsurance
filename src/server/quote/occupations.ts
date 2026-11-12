import { getActiveOccupations } from "#/server/data/reference";

import { CATALOGUE_CACHE_CONTROL } from "./catalogue";

// GET /api/occupations (5.3, call 11). The active rating version only changes in a deploy, and a
// deploy starts with an empty CDN cache, so this uses the catalogue's long cache (5.2, call 13).

/** A failure is a 503 with no-store, so the CDN never keeps it for a year */
export async function occupationsResponse(
  load: () => Promise<readonly { key: string; label: string }[]> = () => getActiveOccupations(),
): Promise<Response> {
  try {
    const occupations = await load();
    return Response.json(
      { occupations },
      { headers: { "Cache-Control": CATALOGUE_CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("occupations: load failed", error);
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
