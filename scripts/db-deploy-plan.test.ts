import { describe, expect, test } from "vite-plus/test";

import { planDeploy } from "./db-deploy-plan";

const url = "postgres://user:pass@example.neon.tech/neondb";

describe("planDeploy", () => {
  test.each(["production", "staging"])("migrates for %s", (target) => {
    expect(planDeploy({ VERCEL_TARGET_ENV: target, DATABASE_URL_UNPOOLED: url })).toEqual({
      action: "migrate",
      message: `db:deploy: applying migrations and reference data for ${target}`,
    });
  });

  test.each([["preview"], ["development"], [undefined]])("skips for %s", (target) => {
    expect(planDeploy({ VERCEL_TARGET_ENV: target, DATABASE_URL_UNPOOLED: url }).action).toBe(
      "skip",
    );
  });

  test("fails fast when production or staging has no direct connection string", () => {
    const plan = planDeploy({ VERCEL_TARGET_ENV: "staging" });
    expect(plan.action).toBe("fail");
    expect(plan.message).toContain("DATABASE_URL_UNPOOLED");
  });

  test("a preview without the variable still skips (no database step)", () => {
    expect(planDeploy({ VERCEL_TARGET_ENV: "preview" }).action).toBe("skip");
  });
});
