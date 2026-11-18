import { describe, expect, it } from "vite-plus/test";

import { normalisePlate, plateError } from "./plate";

describe("normalisePlate", () => {
  it("ignores case, spaces and dashes", () => {
    expect(normalisePlate("vw21-gql ")).toBe("VW21GQL");
    expect(normalisePlate(" v w 2 1 g q l")).toBe("VW21GQL");
  });

  it("copes with a long string without throwing", () => {
    expect(normalisePlate("abcdefghij klmnopqrst")).toBe("ABCDEFGHIJKLMNOPQRST");
  });

  it("has the empty-box error from the spec", () => {
    expect(plateError).toBe("Enter your registration.");
  });
});
