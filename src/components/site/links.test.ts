import { describe, expect, it } from "vite-plus/test";

import {
  accountLink,
  documentsLink,
  footerGroups,
  isCurrent,
  mainNav,
  makeClaimLink,
  paymentsLink,
  trackClaimLink,
} from "./links";

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

describe("shared links", () => {
  it("the landing quick actions use are the footer's own", () => {
    const footer = footerGroups.flatMap((g) => g.links);
    for (const link of [makeClaimLink, trackClaimLink, documentsLink, paymentsLink, accountLink]) {
      expect(footer).toContain(link);
    }
  });
});
