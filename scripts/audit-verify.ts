import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { databaseHost } from "./database-host.ts";
import { failureLine } from "./reset-two-factor-core.ts";

// Checks the audit chain and its daily anchors (4.11, spec call 12):
//   vp run audit:verify
// Walks the whole chain (verifyAuditChain, 4.5b), then confirms every anchor in the bucket still
// matches its row (verifyAgainstAnchors). Uses the database and bucket in .env.local, loaded
// through Vite's module runner so the `#/` imports resolve. Prints row ids, anchor names and
// reasons, never a hash or any row's content. Exits 1 on any problem.

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

console.log(`Database: ${host}`);
console.log(`Bucket: ${process.env.R2_BUCKET?.trim() || "(R2_BUCKET is not set)"}`);

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
  const env = await runner.import<typeof import("../src/server/env.ts")>("/src/server/env.ts");
  const store = await runner.import<typeof import("../src/server/uploads/store.ts")>(
    "/src/server/uploads/store.ts",
  );
  const verify = await runner.import<typeof import("../src/server/audit/verify.ts")>(
    "/src/server/audit/verify.ts",
  );
  const anchors = await runner.import<typeof import("../src/server/audit/anchor.ts")>(
    "/src/server/audit/anchor.ts",
  );
  closeDb = client.closeDb;
  const db = client.getDb().$client;

  const chain = await verify.verifyAuditChain(db, env.getAuditEnv());
  if (!chain.ok) {
    console.error(`Chain broken at row ${chain.rowId}: ${chain.reason}.`);
    code = 1;
  } else {
    const checked = await anchors.verifyAgainstAnchors(db, store.getObjectStore());
    if (checked.ok) {
      console.log(`Chain OK: ${chain.rows} rows. Anchors OK: ${checked.anchors}.`);
    } else {
      console.error(`Chain OK: ${chain.rows} rows. Anchor ${checked.anchor}: ${checked.reason}.`);
      code = 1;
    }
  }
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
