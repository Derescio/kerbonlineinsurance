import { spawnSync } from "node:child_process";

import { planDeploy } from "./db-deploy-plan.ts";

// Runs before `vp build` (the package `build` script). A failed migration fails the build, so the
// previous deployment keeps serving. 4.8 adds the reference-data upsert after the migrate.
const plan = planDeploy(process.env);

if (plan.action === "skip") {
  console.log(plan.message);
} else if (plan.action === "fail") {
  console.error(plan.message);
  process.exit(1);
} else {
  console.log(plan.message);
  const result = spawnSync("pnpm exec drizzle-kit migrate", { stdio: "inherit", shell: true });
  process.exit(result.status ?? 1);
}
