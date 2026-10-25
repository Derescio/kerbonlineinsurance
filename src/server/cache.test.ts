import { describe, expect, it } from "vite-plus/test";

import { publicCacheHeaders } from "#/server/cache";
import { parseEnv } from "#/server/env";

describe("PUBLIC_CACHE_SECONDS", () => {
  it("defaults to 300", () => {
    expect(parseEnv({}).PUBLIC_CACHE_SECONDS).toBe(300);
  });

  it("honours the env var", () => {
    expect(parseEnv({ PUBLIC_CACHE_SECONDS: "1800" }).PUBLIC_CACHE_SECONDS).toBe(1800);
  });

  it("rejects a value that isn't a whole number", () => {
    expect(() => parseEnv({ PUBLIC_CACHE_SECONDS: "soon" })).toThrow(/PUBLIC_CACHE_SECONDS/);
  });
});

describe("publicCacheHeaders", () => {
  it("uses the configured time by default", () => {
    expect(publicCacheHeaders()).toEqual({
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    });
  });

  it("caches at the CDN for the given time", () => {
    expect(publicCacheHeaders(1800)["Cache-Control"]).toBe(
      "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600",
    );
  });
});
