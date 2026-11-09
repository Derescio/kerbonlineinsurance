import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { AuditKeyError, parseKeys } from "../src/server/audit/chain.ts";
import { failureLine } from "./reset-two-factor-core.ts";
import { SeedConfigError, readSeedConfig } from "./seed/guard.ts";

// Fills Neon `dev` with the synthetic cast and crowd (4.9, plan/phases/04-data-auth/
// 09-seed-data.md). Local only, by hand:
//   pnpm db:seed
// Run db:migrate and db:reference first. A second run prints "Already seeded" and changes
// nothing; to start over, reset `dev` from its parent in Neon (engineering.md §3). Prints the
// database host and counts, never the connection string.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

let config;
let keys;
try {
  config = readSeedConfig(process.env);
  keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
} catch (error) {
  if (error instanceof SeedConfigError) console.error(error.message);
  else if (error instanceof AuditKeyError) {
    console.error(
      `Audit keys are not set or invalid (${error.reason}): see .env.example, "Audit (4.5b)".`,
    );
  } else console.error(failureLine(error));
  process.exit(1);
}
console.log(`Database: ${config.host}`);

// Through Vite's module runner, so the app's own `#/` imports resolve (as db:reference does)
const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

let code = 0;
let end: (() => Promise<void>) | undefined;
try {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await runner.import<typeof import("../src/server/db/schema/index.ts")>(
    "/src/server/db/schema/index.ts",
  );
  const seed = await runner.import<typeof import("./seed/write.ts")>("/scripts/seed/write.ts");

  const pool = new Pool({ connectionString: config.url, max: 1 });
  end = () => pool.end();
  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  try {
    const result = await seed.seedDatabase(db as never, { config, keys, crowdSize: 2000 });
    console.log(result.action === "seeded" ? "Seeded:" : "Already seeded:");
    for (const [table, n] of Object.entries(result.counts)) console.log(`  ${table} ${n}`);
    if (result.action === "seeded") {
      console.log(`Staff 2FA: add this to your authenticator app:\n  ${result.totpUri}`);
      for (const [email, codes] of Object.entries(result.backupCodes)) {
        console.log(`Backup codes for ${email}: ${codes.join(" ")}`);
      }
    }
  } catch (error) {
    code = 1;
    if (error instanceof seed.SeedNotReady) console.error(error.message);
    else console.error(failureLine(error));
  }
} catch (error) {
  code = 1;
  console.error(failureLine(error));
} finally {
  await end?.().catch(() => {});
  await runner.close().catch(() => {});
  await server.close().catch(() => {});
}
process.exit(code);
