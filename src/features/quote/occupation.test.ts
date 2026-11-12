import { describe, expect, it } from "vite-plus/test";

import {
  HIDDEN_FROM_JOBS,
  jobOptions,
  occupationFor,
  statusFor,
  statusOptions,
  STATUS_OCCUPATIONS,
} from "./occupation";

const all = [
  { key: "plumber", label: "Plumber" },
  { key: "retired", label: "Retired" },
  { key: "self_employed", label: "Self-employed (other)" },
  { key: "accountant", label: "Accountant" },
  { key: "student", label: "Student" },
  { key: "unemployed", label: "Unemployed" },
  { key: "homemaker", label: "Homemaker" },
];

describe("occupationFor", () => {
  it("fixes the key for a status that isn't a job", () => {
    expect(occupationFor("retired", "plumber")).toBe("retired");
    expect(occupationFor("homemaker", undefined)).toBe("homemaker");
  });

  it("takes the chosen job for employed and self-employed", () => {
    expect(occupationFor("employed", "plumber")).toBe("plumber");
    expect(occupationFor("self_employed", "self_employed")).toBe("self_employed");
    expect(occupationFor("employed", undefined)).toBeUndefined();
  });
});

describe("statusFor", () => {
  it("reads a non-working status back from its key, and nothing from a job", () => {
    expect(statusFor("retired")).toBe("retired");
    expect(statusFor("plumber")).toBeUndefined();
  });
});

describe("jobOptions", () => {
  it("hides the statuses from the employed list", () => {
    const keys = jobOptions(all, "employed").map((o) => o.key);
    expect(keys).toEqual(["plumber", "accountant"]);
    for (const hidden of HIDDEN_FROM_JOBS) expect(keys).not.toContain(hidden);
  });

  it("adds self-employed (other) last for the self-employed", () => {
    const keys = jobOptions(all, "self_employed").map((o) => o.key);
    expect(keys).toEqual(["plumber", "accountant", "self_employed"]);
  });
});

describe("statusOptions", () => {
  it("lists the six statuses in order", () => {
    expect(statusOptions.map((o) => o.label)).toEqual([
      "Employed",
      "Self-employed",
      "Retired",
      "Unemployed",
      "Student",
      "Looking after the home",
    ]);
    expect(Object.keys(STATUS_OCCUPATIONS)).toEqual([
      "retired",
      "unemployed",
      "student",
      "homemaker",
    ]);
  });
});
