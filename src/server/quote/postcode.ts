import { z } from "zod";

import { normalisePostcode } from "#/features/quote/postcode";
import { findPostcodeArea, insertPostcodeArea, type Db } from "#/server/data/postcode-rows";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";

// The car step's postcode check (5.2, call 15): does the postcode from /quote exist? postcodes.io
// answers once per postcode and postcode_areas remembers the ones that do. Only a definite "no"
// stops the visitor: a slow or broken postcodes.io, the rate limit or its query failing all let
// them carry on, because a free service mustn't stop a quote. A cache that can't be read or
// written is skipped, not fatal.

export type PostcodeCheck = "found" | "not_found" | "unavailable";

/** Lookups that reach postcodes.io, per IP; a stored postcode doesn't count */
export const POSTCODE_LOOKUP_RULE = { max: 60, windowSeconds: 60 * 60 };

const TIMEOUT_MS = 2000;

const lookupBody = z.object({
  result: z.object({
    postcode: z.string(),
    outcode: z.string(),
    admin_district: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string(),
  }),
});

export interface PostcodeCheckDeps {
  fetch?: typeof fetch;
  secret?: string;
  timeoutMs?: number;
  db?: Db;
}

/** Never throws: every failure is "unavailable" */
export async function checkPostcodeExists(
  input: string,
  headers: Headers,
  deps: PostcodeCheckDeps = {},
): Promise<PostcodeCheck> {
  const postcode = normalisePostcode(input);
  if (!postcode) return "not_found";

  try {
    if (await findPostcodeArea(postcode, deps.db)) return "found";
  } catch (error) {
    // The cache only saves a lookup: a preview runs before its migration, so ask postcodes.io
    console.warn("postcode check: cache read failed", error);
  }

  try {
    const subject = await rateLimitSubject(null, headers, deps.secret);
    await limit(`postcode.lookup:${subject}`, POSTCODE_LOOKUP_RULE);
  } catch {
    // Over the limit (limit() logs it) or the limit's own query failed
    return "unavailable";
  }

  let result: z.infer<typeof lookupBody>["result"];
  try {
    const response = await (deps.fetch ?? fetch)(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(" ", ""))}`,
      { signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS) },
    );
    if (response.status === 404) return "not_found";
    if (!response.ok) return "unavailable";
    const parsed = lookupBody.safeParse(await response.json());
    if (!parsed.success || normalisePostcode(parsed.data.result.postcode) !== postcode) {
      return "unavailable";
    }
    result = parsed.data.result;
  } catch (error) {
    console.warn("postcode check: postcodes.io failed", error);
    return "unavailable";
  }

  try {
    await insertPostcodeArea(
      {
        postcode,
        outcode: result.outcode,
        adminDistrict: result.admin_district ?? null,
        region: result.region ?? null,
        country: result.country,
      },
      deps.db,
    );
  } catch (error) {
    // It exists either way; the next visitor looks it up again
    console.warn("postcode check: cache write failed", error);
  }
  return "found";
}
