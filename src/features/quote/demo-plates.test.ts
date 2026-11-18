import { describe, expect, it } from "vite-plus/test";

import { demoPlates, findDemoPlate } from "./demo-plates";

// 5.2, call 6: six believable plates that can never belong to a real car

describe("demoPlates", () => {
  it("lists six plates in the UK format", () => {
    expect(demoPlates).toHaveLength(6);
    for (const { plate } of demoPlates) expect(plate).toMatch(/^[A-Z]{2}\d{2} [A-Z]{3}$/);
  });

  it("puts an I or a Q in the last three letters, which the DVLA never issues there", () => {
    for (const { plate } of demoPlates) expect(plate.slice(-3)).toMatch(/[IQ]/);
  });

  it("gives each plate the age identifier of its car's year", () => {
    for (const { plate, year } of demoPlates) {
      const age = Number(plate.slice(2, 4));
      expect([year % 100, (year % 100) + 50]).toContain(age);
    }
  });
});

describe("findDemoPlate", () => {
  it("matches whatever the case and spacing", () => {
    expect(findDemoPlate("vw21gql")?.model).toBe("Golf");
    expect(findDemoPlate(" VW21 GQL ")?.make).toBe("Volkswagen");
  });

  it("knows nothing about other plates", () => {
    expect(findDemoPlate("KR24 BXL")).toBeNull();
    expect(findDemoPlate("")).toBeNull();
  });
});
