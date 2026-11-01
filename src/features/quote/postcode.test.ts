import { describe, expect, it } from "vite-plus/test";

import { normalisePostcode, postcodeError, postcodeSchema } from "./postcode";

describe("normalisePostcode", () => {
  it("upper-cases and puts one space before the inward code", () => {
    expect(normalisePostcode("e83rl")).toBe("E8 3RL");
    expect(normalisePostcode("SW1A 1AA")).toBe("SW1A 1AA");
    expect(normalisePostcode("  sw1a1aa ")).toBe("SW1A 1AA");
    expect(normalisePostcode("m1   1ae")).toBe("M1 1AE");
    expect(normalisePostcode("CR2 6XH")).toBe("CR2 6XH");
    expect(normalisePostcode("DN55 1PT")).toBe("DN55 1PT");
  });

  it("rejects anything that isn't a full UK postcode", () => {
    for (const input of [
      "",
      "   ",
      "E8",
      "123",
      "ABCDEFG",
      "E8 3R",
      "E8 3RLL",
      "8E 3RL",
      "E8-3RL",
    ]) {
      expect(normalisePostcode(input), input).toBeNull();
    }
  });
});

describe("postcodeSchema", () => {
  it("outputs the normalised postcode", () => {
    expect(postcodeSchema.parse("e8 3rl")).toBe("E8 3RL");
  });

  it("fails with the error copy", () => {
    const result = postcodeSchema.safeParse("E8");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(postcodeError);
  });
});
