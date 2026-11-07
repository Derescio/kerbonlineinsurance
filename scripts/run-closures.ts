import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { AuditKeyError, parseKeys } from "../src/server/audit/chain.ts";
import { databaseHost } from "./database-host.ts";
import { failureLine } from "./reset-two-factor-core.ts";

// The daily account-closure job, run by hand (4.7, call 14), for tests and manual checks:
//   pnpm account:run-closures
//   NOW=2026-12-08T03:00:00Z pnpm account:run-closures   (a run "30 days later")
// It runs the app's own runClosures (ruling R4: no copy of the closure or audit logic), loaded
// through Vite's module runner so the `#/` imports resolve. It never emails: the customer emails
// are counted and dropped. Prints the database host and closure counts, never an email.

// Locally the URL comes from .env.local (Neon `dev`), as in drizzle.config.ts. A DATABASE_URL already
// set in the shell wins (loadEnvFile never overrides), so `prod` is an explicit choice.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

try {
  parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
} catch (error) {
  if (!(error instanceof AuditKeyError)) throw error;
  console.error(
    `Audit keys are not set or invalid (${error.reason}): see .env.example, "Audit (4.5b)".`,
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const host = databaseHost(url);
if (!host) {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

// NOW= is an ISO date; the job picks up every closure whose window ended by then
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("NOW is not a valid ISO date, e.g. NOW=2026-12-08T03:00:00Z.");
  process.exit(1);
}

console.log(`Database: ${host}`);
console.log(`Now: ${now.toISOString()}`);

// One module runner, so runClosures and closeDb share the app's single pool
const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

let code = 0;
let closeDb: (() => Promise<void>) | undefined;
try {
  const client = await runner.import<typeof import("../src/server/db/client.ts")>(
    "/src/server/db/client.ts",
  );
  const job = await runner.import<typeof import("../src/server/account/run-closures.ts")>(
    "/src/server/account/run-closures.ts",
  );
  closeDb = client.closeDb;

  let skipped = 0;
  const result = await job.runClosures(client.getDb(), now, {
    sendEmail: async () => {
      skipped++;
    },
    defer: () => {},
  });
  console.log(
    `Closed ${result.closed}, held ${result.held}, failed ${result.failed}. Emails not sent: ${skipped}.`,
  );
  if (result.failed > 0) code = 1;
} catch (error) {
  code = 1;
  // Name and SQLSTATE only: a message can carry row data
  console.error(failureLine(error));
} finally {
  await closeDb?.().catch(() => {});
  await runner.close().catch(() => {});
  await server.close().catch(() => {});
}
process.exit(code);
