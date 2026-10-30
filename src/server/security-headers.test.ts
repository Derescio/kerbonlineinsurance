import { describe, expect, it } from "vite-plus/test";

import {
  contentSecurityPolicy,
  createNonce,
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
