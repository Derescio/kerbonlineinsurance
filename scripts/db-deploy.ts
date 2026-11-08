import { spawnSync } from "node:child_process";

import { planDeploy } from "./db-deploy-plan.ts";

// Runs before `vp build` (the package `build` script). A failed migration fails the build, so the
// previous deployment keeps serving. After a successful migrate, the reference data (vehicle
// catalogue and rating versions, 4.8) is upserted; a failure there fails the build too.
const plan = planDeploy(process.env);

if (plan.action === "skip") {
  console.log(plan.message);
} else if (plan.action === "fail") {
  console.error(plan.message);
  process.exit(1);
} else {
  console.log(plan.message);
  const migrate = spawnSync("pnpm exec drizzle-kit migrate", { stdio: "inherit", shell: true });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);
  const reference = spawnSync("node scripts/reference-data.ts", { stdio: "inherit", shell: true });
  process.exit(reference.status ?? 1);
}
