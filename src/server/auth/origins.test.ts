import { describe, expect, it } from "vite-plus/test";

import {
  LOCAL_URL,
  PREVIEW_ORIGIN_PATTERN,
  PRODUCTION_URL,
  STAGING_URL,
  authUrls,
} from "./origins";

describe("authUrls", () => {
  it("production trusts only itself and never proxies", () => {
    expect(authUrls({ VERCEL_TARGET_ENV: "production", BETTER_AUTH_URL: PRODUCTION_URL })).toEqual({
      baseURL: PRODUCTION_URL,
      trustedOrigins: [PRODUCTION_URL],
      oauthProxy: null,
    });
  });

  it("staging trusts itself and receives the previews' Google callbacks", () => {
    expect(authUrls({ VERCEL_TARGET_ENV: "staging", BETTER_AUTH_URL: STAGING_URL })).toEqual({
      baseURL: STAGING_URL,
      trustedOrigins: [STAGING_URL],
      oauthProxy: { productionURL: STAGING_URL, currentURL: STAGING_URL },
    });
  });

  it("a preview uses its own deploy URL, our preview pattern only, and proxies Google via staging", () => {
    const urls = authUrls({
      VERCEL_TARGET_ENV: "preview",
      VERCEL_URL: "kerbonlineinsurance-abc123-damion-wilsons-projects.vercel.app",
    });
    const preview = "https://kerbonlineinsurance-abc123-damion-wilsons-projects.vercel.app";
    expect(urls.baseURL).toBe(preview);
    expect(urls.trustedOrigins).toEqual([preview, PREVIEW_ORIGIN_PATTERN]);
    expect(urls.oauthProxy).toEqual({ productionURL: STAGING_URL, currentURL: preview });
  });

  it("never trusts every *.vercel.app (decision 8)", () => {
    expect(PREVIEW_ORIGIN_PATTERN).toBe(
      "https://kerbonlineinsurance-*-damion-wilsons-projects.vercel.app",
    );
  });

  it("local development is localhost, no proxy", () => {
    expect(authUrls({ BETTER_AUTH_URL: LOCAL_URL })).toEqual({
      baseURL: LOCAL_URL,
      trustedOrigins: [LOCAL_URL],
      oauthProxy: null,
    });
    expect(authUrls({}).baseURL).toBe(LOCAL_URL);
  });
});
