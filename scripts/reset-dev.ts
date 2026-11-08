import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import pg from "pg";

import { failureLine } from "./reset-two-factor-core.ts";
import { confirmedHost, emptyDatabase } from "./reset-dev-core.ts";
import { SeedConfigError, readSeedConfig } from "./seed/guard.ts";

// Rebuilds Neon `dev` from nothing (plan/dev-database.md): empties it, runs every migration, loads
// the reference data, seeds, and checks the app role's grants. Nothing is copied from `prod`.
//   pnpm db:reset-dev -- --confirm <dev host>
// It refuses any host but SEED_DATABASE_HOST, any Vercel build, and a run without --confirm naming
// that host. The seed's settings are checked first, so a bad value never leaves `dev` empty.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

let config;
try {
  config = readSeedConfig(process.env);
} catch (error) {
  console.error(error instanceof SeedConfigError ? error.message : failureLine(error));
  process.exit(1);
}
const { host, url } = config;
console.log(`Database: ${host}`);

if (!confirmedHost(host, process.argv.slice(2))) {
  console.error(
    [
      `This deletes everything in ${host}: every table, row and account, then rebuilds it.`,
      "To go ahead, name the host:",
      `  vp run db:reset-dev -- --confirm ${host}`,
    ].join("\n"),
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await emptyDatabase(client);
  console.log("Emptied.");
} catch (error) {
  console.error(`Reset failed, nothing changed: ${failureLine(error)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

// Each step only after the one before it worked; a failure says where to pick up
const steps = [
  ["Migrations", "pnpm exec drizzle-kit migrate", "vp run db:migrate"],
  ["Reference data", "node scripts/reference-data.ts", "vp run db:reference"],
  ["Seed", "node scripts/seed.ts", "vp run db:seed"],
  ["App role check", "node scripts/check-app-role.ts", "vp run db:check-app-role"],
] as const;
for (const [label, command, resume] of steps) {
  console.log(`\n${label}…`);
  const run = spawnSync(command, { stdio: "inherit", shell: true });
  if (run.status !== 0) {
    console.error(`\n${label} failed. Fix it, then carry on from: ${resume}`);
    process.exit(run.status ?? 1);
  }
}

console.log(
  [
    "",
    "dev is rebuilt. Your own accounts are gone with everything else:",
    "  1. Sign up again on the staging URL and confirm the email.",
    '  2. vp run auth:make-admin <your email> --name "<your name>"',
  ].join("\n"),
);
