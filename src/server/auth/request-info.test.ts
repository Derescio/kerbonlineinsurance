import { describe, expect, it } from "vite-plus/test";

import { clientIp, hashIp, summariseUserAgent } from "./request-info";

const SECRET = "test-secret-at-least-thirty-two-characters";

describe("clientIp", () => {
  it("prefers Vercel's own header, which a client can't spoof", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe(
      "198.51.100.1",
    );
  });

  it("returns null when there's nothing to go on", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});

describe("hashIp", () => {
  it("is a stable 64-character hex HMAC, not the address", async () => {
    const first = await hashIp("203.0.113.7", SECRET);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("203");
    expect(await hashIp("203.0.113.7", SECRET)).toBe(first);
  });

  it("is keyed: the same address under another secret hashes differently", async () => {
    expect(await hashIp("203.0.113.7", SECRET)).not.toBe(
      await hashIp("203.0.113.7", `${SECRET}-other`),
    );
  });

  it("gives null for a missing address", async () => {
    expect(await hashIp(null, SECRET)).toBeNull();
  });
});

describe("summariseUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iPhone",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"],
  ])("%s → %s", (ua, expected) => {
    expect(summariseUserAgent(ua)).toBe(expected);
  });

  it("never returns the raw string for something it doesn't know", () => {
    expect(summariseUserAgent("curl/8.4.0")).toBe("Unknown browser");
    expect(summariseUserAgent(null)).toBeNull();
  });
});
