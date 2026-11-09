import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { databaseHost } from "./database-host.ts";
import { failureLine } from "./reset-two-factor-core.ts";

// The daily uploads cleanup, run by hand (4.10, call 12): Vercel Cron only calls Production.
//   vp run uploads:cleanup
//   NOW=2026-12-08T03:30:00Z vp run uploads:cleanup   (a run "a day later")
// It runs the app's own runUploadsCleanup against the database and bucket in .env.local, loaded
// through Vite's module runner so the `#/` imports resolve. Prints the host and the counts, never
// an object key.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

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

const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("NOW is not a valid ISO date, e.g. NOW=2026-12-08T03:30:00Z.");
  process.exit(1);
}

console.log(`Database: ${host}`);
console.log(`Bucket: ${process.env.R2_BUCKET?.trim() || "(R2_BUCKET is not set)"}`);
console.log(`Now: ${now.toISOString()}`);

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
  const store = await runner.import<typeof import("../src/server/uploads/store.ts")>(
    "/src/server/uploads/store.ts",
  );
  const job = await runner.import<typeof import("../src/server/uploads/cleanup.ts")>(
    "/src/server/uploads/cleanup.ts",
  );
  closeDb = client.closeDb;

  const result = await job.runUploadsCleanup(client.getDb(), store.getObjectStore(), now);
  console.log(`Purged ${result.purged}, failed ${result.failed}.`);
  if (result.failed > 0) code = 1;
} catch (error) {
  code = 1;
  // Name and SQLSTATE only: a message can carry row data or a key
  console.error(failureLine(error));
} finally {
  await closeDb?.().catch(() => {});
  await runner.close().catch(() => {});
  await server.close().catch(() => {});
}
process.exit(code);
