import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { databaseHost } from "./database-host.ts";
import { failureLine } from "./reset-two-factor-core.ts";

// Writes the vehicle catalogue and the rating versions (4.8, plan/phases/04-data-auth/
// 08-reference-data.md). db-deploy.ts runs it after the migrations on staging and production
// builds; locally:
//   pnpm db:reference
// It connects as the owner (DATABASE_URL_UNPOOLED): kerb_app can only read these tables. Safe to
// run any number of times. Prints the database host and counts, never the connection string.

// Locally the URL comes from .env.local (Neon `dev`), as in drizzle.config.ts. A value already set
// in the shell wins (loadEnvFile never overrides), so `prod` is an explicit choice.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error(
    "DATABASE_URL_UNPOOLED is not set (the owner connection; the app role can't write reference data).",
  );
  process.exit(1);
}
const host = databaseHost(url);
if (!host) {
  console.error("DATABASE_URL_UNPOOLED is not a valid URL.");
  process.exit(1);
}
console.log(`Database: ${host}`);

// Through Vite's module runner, so the app's own `#/` imports resolve (no copy of the upsert)
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
  const reference = await runner.import<typeof import("../src/server/data/reference.ts")>(
    "/src/server/data/reference.ts",
  );

  const pool = new Pool({ connectionString: url, max: 1 });
  end = () => pool.end();
  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  try {
    const result = await reference.upsertReferenceData(db);
    const { inserted, updated, deactivated } = result.catalogue;
    const changed =
      inserted + updated + deactivated > 0 || result.versions.some((v) => v.action === "inserted");
    if (!changed) {
      console.log("Reference data: no changes");
    } else {
      for (const v of result.versions) console.log(`${v.product} v${v.version}: ${v.action}`);
      console.log(
        `Catalogue: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated`,
      );
    }
  } catch (error) {
    code = 1;
    // These two carry no row data: the product, version and source problems only
    if (
      error instanceof reference.ReferenceDataConflict ||
      error instanceof reference.ReferenceDataInvalid
    ) {
      console.error(error.message);
    } else {
      console.error(failureLine(error));
    }
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
