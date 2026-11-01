import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The wrapper reads its env when it loads, so each test sets the env and imports a fresh copy
async function loadAnalytics(configured: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", configured ? "phc_test" : "");
  vi.stubEnv("VITE_PUBLIC_POSTHOG_HOST", configured ? "https://us.i.posthog.com" : "");
  return import("#/lib/analytics");
}

function fakeClient(consent: "granted" | "denied" | "pending" = "pending") {
  return {
    capture: vi.fn(),
    captureException: vi.fn(),
    get_explicit_consent_status: () => consent,
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    clear_opt_in_out_capturing: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    getFeatureFlag: vi.fn(),
    onFeatureFlags: vi.fn((_callback: () => void) => () => {}),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics", () => {
  it("queues events until PostHog loads, then sends them in order", async () => {
    const analytics = await loadAnalytics(true);
    analytics.track("quote_started", { entry_point: "hero_postcode_form" });
    analytics.track("quote_cta_clicked");

    const client = fakeClient();
    analytics.attachPosthog(client);
    expect(client.capture.mock.calls).toEqual([
      ["quote_started", { entry_point: "hero_postcode_form" }],
      ["quote_cta_clicked", undefined],
    ]);

    analytics.track("quote_type_selected", { product_type: "car" });
    expect(client.capture).toHaveBeenLastCalledWith("quote_type_selected", { product_type: "car" });
    expect(client.capture).toHaveBeenCalledTimes(3);
  });

  it("does nothing when PostHog isn't configured", async () => {
    const analytics = await loadAnalytics(false);
    expect(analytics.analyticsEnabled).toBe(false);
    analytics.track("quote_started");
    analytics.startAnalytics();
    expect(analytics.consentStatus()).toBeNull();

    // Nothing was queued: a client attached later receives no events
    const client = fakeClient();
    analytics.attachPosthog(client);
    expect(client.capture).not.toHaveBeenCalled();
  });

  it("reads consent only once loaded, and resumes replay for a visitor who accepted before", async () => {
    const analytics = await loadAnalytics(true);
    expect(analytics.consentStatus()).toBeNull();

    const client = fakeClient("granted");
    analytics.attachPosthog(client);
    expect(analytics.consentStatus()).toBe("granted");
    expect(client.startSessionRecording).toHaveBeenCalledOnce();
  });

  it("sends requests through the same-origin proxy", async () => {
    const analytics = await loadAnalytics(true);
    expect(analytics.posthogApiHost).toBe("/ingest");
  });
});

describe("getFlag", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives undefined when PostHog isn't configured", async () => {
    const analytics = await loadAnalytics(false);
    await expect(analytics.getFlag("hero-cta-copy")).resolves.toBeUndefined();
  });

  it("gives undefined without reading the flag when the visitor hasn't accepted", async () => {
    const analytics = await loadAnalytics(true);
    const client = fakeClient("pending");
    analytics.attachPosthog(client);
    await expect(analytics.getFlag("hero-cta-copy")).resolves.toBeUndefined();
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
  });

  it("waits for PostHog to load, then for flags, and gives the variant", async () => {
    const analytics = await loadAnalytics(true);
    const result = analytics.getFlag("hero-cta-copy");

    const client = fakeClient("granted");
    client.getFeatureFlag.mockReturnValue("see-my-price");
    client.onFeatureFlags.mockImplementation((callback: () => void) => {
      callback();
      return () => {};
    });
    analytics.attachPosthog(client);

    await expect(result).resolves.toBe("see-my-price");
    expect(client.getFeatureFlag).toHaveBeenCalledWith("hero-cta-copy");
  });

  it("gives undefined when flags take longer than the timeout", async () => {
    vi.useFakeTimers();
    const analytics = await loadAnalytics(true);
    const client = fakeClient("granted");
    analytics.attachPosthog(client);

    const result = analytics.getFlag("hero-cta-copy", 1500);
    vi.advanceTimersByTime(1500);
    await expect(result).resolves.toBeUndefined();
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
  });
});

describe("PostHog imports", () => {
  it("only src/lib/ imports PostHog, so it stays out of the main bundle", () => {
    // A value import anywhere else would pull posthog-js into the main chunk; types are fine
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+["'](posthog-js|@posthog\/[^"']+)["']/m;
    const offenders = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !file.startsWith(join("lib", "")))
      .filter((file) => valueImport.test(readFileSync(join("src", file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
