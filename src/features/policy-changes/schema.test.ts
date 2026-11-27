import { describe, expect, it } from "vite-plus/test";

import { homeErrors } from "#/features/quote/schemas/home-steps";

import { policyChangeSchema } from "./schema";

// The 6.3c kinds as the server accepts them (spec decisions 3, 5 and 6)

const schema = policyChangeSchema("2026-11-25");
const variant = "6f1c2b0e-4d1a-4c3e-9a7b-2f5e8d9c1a00";

function messages(raw: unknown): string[] {
  const parsed = schema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
}

describe("policyChangeSchema: 6.3c kinds", () => {
  it("car_replaced normalises the registration and accepts null", () => {
    const typed = schema.parse({
      kind: "car_replaced",
      catalogueVariantId: variant,
      registration: " yr21  kzp ",
      currentMileage: 18_200,
    });
    expect(typed).toMatchObject({ kind: "car_replaced", registration: "YR21KZP" });
    const manual = schema.parse({
      kind: "car_replaced",
      catalogueVariantId: variant,
      registration: null,
      currentMileage: 0,
    });
    expect(manual).toMatchObject({ registration: null, currentMileage: 0 });
  });

  it("car_replaced refuses a mileage over 999,999 with the journey's message", () => {
    expect(
      messages({
        kind: "car_replaced",
        catalogueVariantId: variant,
        registration: null,
        currentMileage: 1_000_000,
      }),
    ).toContain("Enter a mileage up to 999,999.");
  });

  it("home_contents refuses valuables over contents with homeErrors.valuablesOverContents", () => {
    expect(
      messages({ kind: "home_contents", contentsValuePence: 1_000_000, valuablesPence: 1_500_000 }),
    ).toContain(homeErrors.valuablesOverContents);
    expect(
      schema.parse({
        kind: "home_contents",
        contentsValuePence: 4_500_000,
        valuablesPence: 600_000,
      }),
    ).toEqual({ kind: "home_contents", contentsValuePence: 4_500_000, valuablesPence: 600_000 });
  });

  it("home_contents refuses a contents value outside £5,000 to £500,000", () => {
    expect(
      messages({ kind: "home_contents", contentsValuePence: 400_000, valuablesPence: 0 }),
    ).toContain(homeErrors.contentsValue);
  });

  it("home_security refuses an alarm type outside alarmTypes", () => {
    const good = {
      kind: "home_security",
      lockType: "multipoint",
      windowLocks: "all_accessible",
      alarmType: "monitored",
      hasSmokeAlarm: true,
    };
    expect(schema.parse(good)).toEqual(good);
    expect(schema.safeParse({ ...good, alarmType: "laser_grid" }).success).toBe(false);
  });
});
