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

  it("is Choose cover on Choose cover and the home offer (5.5)", () => {
    expect(journeyStepOf("/quote/car", { step: "cover" })).toBe(2);
    expect(journeyStepOf("/quote/car", { step: "add-home" })).toBe(2);
  });

  it("is Buy on the gate (5.6, decision 2)", () => {
    expect(journeyStepOf("/quote/car", { step: "buy" })).toBe(3);
  });

  it("is Buy on Confirm and pay and You're covered, and absent on Your saved quotes", () => {
    expect(journeyStepOf("/quote/pay/0193a0b2-1c3d-7e4f-8a5b-6c7d8e9f0a1b", {})).toBe(3);
    expect(journeyStepOf("/quote/covered/0193a0b2-1c3d-7e4f-8a5b-6c7d8e9f0a1b", {})).toBe(3);
    expect(journeyStepOf("/quote/retrieve", {})).toBeNull();
  });
});
