import { describe, expect, it } from "vite-plus/test";

import { journeyStepOf } from "./frame";

describe("journeyStepOf", () => {
  it("has no step before a journey starts", () => {
    expect(journeyStepOf("/quote", {})).toBeNull();
    expect(journeyStepOf("/quote/", {})).toBeNull();
    expect(journeyStepOf("/quote/coming-soon", {})).toBeNull();
  });

  it("is Your details on the car and home steps", () => {
    expect(journeyStepOf("/quote/car", {})).toBe(0);
    expect(journeyStepOf("/quote/car", { step: "drivers" })).toBe(0);
    expect(journeyStepOf("/quote/car/", {})).toBe(0);
    expect(journeyStepOf("/quote/home", {})).toBe(0);
  });

  it("is Your quote on the quote view", () => {
    expect(journeyStepOf("/quote/car", { step: "quote" })).toBe(1);
  });
});
