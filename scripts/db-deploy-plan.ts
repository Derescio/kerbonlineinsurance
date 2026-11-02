// Which Vercel builds migrate the database (plan/engineering.md section 3). Production migrates
// `prod` and Staging migrates `dev`. Previews share `dev` with Staging, so they skip it; local
// builds and CI have no VERCEL_TARGET_ENV and skip it too.
const MIGRATING_TARGETS = new Set(["production", "staging"]);

export type DeployPlan =
  | { action: "skip"; message: string }
  | { action: "fail"; message: string }
  | { action: "migrate"; message: string };

export function planDeploy(env: Record<string, string | undefined>): DeployPlan {
  const target = env.VERCEL_TARGET_ENV;
  if (!target || !MIGRATING_TARGETS.has(target)) {
    return {
      action: "skip",
      message: `db:deploy skipped (target "${target ?? "none"}" is not production or staging)`,
    };
  }
  if (!env.DATABASE_URL_UNPOOLED) {
    return {
      action: "fail",
      message: `db:deploy: DATABASE_URL_UNPOOLED is not set for ${target} (Neon's direct connection string)`,
    };
  }
  return { action: "migrate", message: `db:deploy: applying migrations for ${target}` };
}
