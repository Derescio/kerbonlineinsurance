import { expect, type APIRequestContext, type APIResponse, type Response } from "@playwright/test";

/**
 * Checks a page is CDN-cached. Vercel's CDN uses s-maxage and strips it from what the browser gets
 * (public, max-age=0), so on a deploy check the CDN served the next request from cache. Elsewhere
 * (vp preview) there's no CDN in front, so check the origin's header.
 */
export async function expectCdnCached(
  request: APIRequestContext,
  path: string,
  response: Response | APIResponse | null,
) {
  if (response?.headers()["x-vercel-cache"]) {
    await expect
      .poll(async () => (await request.get(path)).headers()["x-vercel-cache"], { timeout: 15_000 })
      .toMatch(/^(HIT|STALE)$/);
  } else {
    const cacheControl = response?.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("s-maxage=");
    expect(cacheControl).toContain("stale-while-revalidate=");
  }
}
