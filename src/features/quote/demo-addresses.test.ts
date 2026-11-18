import { describe, expect, it } from "vite-plus/test";

import { demoAddresses } from "./demo-addresses";

// 5.7, decision 4: postcodes.io has no street addresses, so a postcode gets a made-up list that's
// the same every time.

describe("demoAddresses", () => {
  it("gives the same list for the same postcode", () => {
    expect(demoAddresses("E8 3RL", "Hackney")).toEqual(demoAddresses("E8 3RL", "Hackney"));
  });

  it("gives different streets for different postcodes", () => {
    expect(demoAddresses("E8 3RL", "Hackney")[0]!.line1).not.toBe(
      demoAddresses("M1 1AE", "Manchester")[0]!.line1,
    );
  });

  it("lists 8 to 12 addresses in the given town, some of them flats", () => {
    const list = demoAddresses("E8 3RL", "Hackney");
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.length).toBeLessThanOrEqual(12);
    for (const a of list) {
      expect(a.line1.trim()).not.toBe("");
      expect(a.town).toBe("Hackney");
    }
    expect(list.some((a) => a.line1.startsWith("Flat "))).toBe(true);
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
  });

  it("reads the postcode however it was typed", () => {
    expect(demoAddresses("e83rl", "Hackney")).toEqual(demoAddresses("E8 3RL", "Hackney"));
  });
});
