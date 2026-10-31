import { describe, expect, it } from "vite-plus/test";

import {
  contentSecurityPolicy,
  createNonce,
  posthogOrigins,
  staticSecurityHeaders,
} from "#/server/security-headers";

describe("createNonce", () => {
  it("is base64 of 16 random bytes", () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("is different every time", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("contentSecurityPolicy", () => {
  const csp = contentSecurityPolicy("abc123");

  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows only same-origin and nonce'd scripts", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows inline style attributes only, not inline <style> or scripts", () => {
    expect(directive("style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
    expect(directive("style-src")).toBe("style-src 'self' 'nonce-abc123'");
    expect(csp.match(/unsafe-inline/g)).toHaveLength(1);
  });

  it("blocks framing, plugins and base-tag hijacks", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("allows PostHog's scripts and ingestion only when a host is configured", () => {
    const withPosthog = contentSecurityPolicy("abc123", "https://us.i.posthog.com");
    const posthog = "https://us.i.posthog.com https://us-assets.i.posthog.com";

    expect(withPosthog).toContain(`script-src 'self' 'nonce-abc123' ${posthog};`);
    expect(withPosthog).toContain(`connect-src 'self' ${posthog};`);
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });
});

describe("posthogOrigins", () => {
  it("adds the assets host for PostHog Cloud regions", () => {
    expect(posthogOrigins("https://eu.i.posthog.com/")).toEqual([
      "https://eu.i.posthog.com",
      "https://eu-assets.i.posthog.com",
    ]);
  });

  it("uses a reverse proxy host as is, and nothing for same-origin or unset", () => {
    expect(posthogOrigins("https://e.example.com/ingest")).toEqual(["https://e.example.com"]);
    expect(posthogOrigins("/ingest")).toEqual([]);
    expect(posthogOrigins(undefined)).toEqual([]);
  });
});

describe("staticSecurityHeaders", () => {
  it("sets HSTS, nosniff, referrer and permissions policies", () => {
    expect(staticSecurityHeaders).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    expect(staticSecurityHeaders["Permissions-Policy"]).toContain("camera=()");
  });
});
