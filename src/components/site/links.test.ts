import { describe, expect, it } from "vite-plus/test";

import { footerGroups, isCurrent, mainNav } from "./links";

describe("isCurrent", () => {
  it("matches the page itself and pages under it", () => {
    expect(isCurrent("/claims", "/claims")).toBe(true);
    expect(isCurrent("/claims", "/claims/track")).toBe(true);
  });

  it("doesn't match a sibling that shares a prefix, home, or no path", () => {
    expect(isCurrent("/claims", "/claimsx")).toBe(false);
    expect(isCurrent("/", "/")).toBe(false);
    expect(isCurrent("/claims", undefined)).toBe(false);
  });
});

describe("links", () => {
  it("are all site-relative paths", () => {
    const all = [...mainNav, ...footerGroups.flatMap((g) => g.links)];
    for (const link of all) expect(link.href).toMatch(/^\/[a-z]/);
  });
});
