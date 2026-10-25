import { env } from "#/server/env";

// Cache-Control for public pages (landing, /reviews). The CDN cache time comes from one
// setting, PUBLIC_CACHE_SECONDS (default 300). See plan/engineering.md section 5.
export function publicCacheHeaders(seconds: number = env.PUBLIC_CACHE_SECONDS) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`,
  };
}
