import { describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/server/auth/actor";

import { rateLimitIp, rateLimitSubject, slidingEstimate } from "./rate-limit";

const SECRET = "test-secret-test-secret-test-secret-123";

function headersWith(ip?: string): Headers {
  return new Headers(ip ? { "x-vercel-forwarded-for": ip } : {});
}

describe("slidingEstimate", () => {
  it("weights the previous window by how much of it is still inside", () => {
    expect(slidingEstimate(10, 1, 0, 60)).toBe(11);
    expect(slidingEstimate(10, 1, 30, 60)).toBe(6);
    expect(slidingEstimate(10, 1, 60, 60)).toBe(1);
  });

  it("never goes negative on the previous window", () => {
    expect(slidingEstimate(10, 1, 90, 60)).toBe(1);
  });
});

describe("rateLimitIp", () => {
  it("leaves IPv4 alone and unwraps IPv4-mapped IPv6", () => {
    expect(rateLimitIp("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("cuts IPv6 to its /64", () => {
    expect(rateLimitIp("2001:db8:0:0:1::2")).toBe("2001:db8:0:0::/64");
  });

  it("gives every spelling of one /64 the same result", () => {
    const a = rateLimitIp("2001:DB8::1");
    expect(a).toBe("2001:db8:0:0::/64");
    expect(rateLimitIp("2001:db8:0:0:1::2")).toBe(a);
    expect(rateLimitIp("2001:0db8:0000:0000:ffff::9")).toBe(a);
  });

  it("tells different /64s apart", () => {
    expect(rateLimitIp("2001:db8:0:1::1")).not.toBe(rateLimitIp("2001:db8::1"));
  });

  it("handles :: at either end", () => {
    expect(rateLimitIp("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitIp("fe80::")).toBe("fe80:0:0:0::/64");
  });
});

describe("rateLimitSubject", () => {
  it("uses the user id for a signed-in actor", async () => {
    const actor: Actor = {
      userId: "u1",
      customerId: null,
      staff: null,
      twoFactor: { enabled: false, verifiedAt: null },
    };
    expect(await rateLimitSubject(actor, headersWith("203.0.113.7"), SECRET)).toBe("user:u1");
  });

  it("uses a keyed hash of the IP for a guest, never the address", async () => {
    const subject = await rateLimitSubject(null, headersWith("203.0.113.7"), SECRET);
    expect(subject).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(subject).not.toContain("203.0.113.7");
  });

  it("gives two addresses in one /64 the same subject", async () => {
    const a = await rateLimitSubject(null, headersWith("2001:db8:0:0:1::2"), SECRET);
    const b = await rateLimitSubject(null, headersWith("2001:db8::ffff"), SECRET);
    expect(a).toBe(b);
  });

  it("falls back to ip:unknown with no IP", async () => {
    expect(await rateLimitSubject(null, headersWith(), SECRET)).toBe("ip:unknown");
  });
});
