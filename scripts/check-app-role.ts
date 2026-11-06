import { existsSync } from "node:fs";

import pg from "pg";

import { AuditKeyError, parseKeys } from "../src/server/audit/chain.ts";
import { checkAppRole } from "./check-app-role-core.ts";
import { databaseHost } from "./database-host.ts";

// Checks a Neon branch's app role and audit chain (4.5b):
//   vp run db:check-app-role
// Connect with the branch's kerb_app URL. Prints PASS or FAIL per check, never the URL or a key.

// A DATABASE_URL already set in the shell wins (loadEnvFile never overrides)
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

let keys;
try {
  keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
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
console.log(`Database: ${host}`);

const client = new pg.Client({ connectionString: url });
let code = 0;
try {
  await client.connect();
  for (const check of await checkAppRole(client, keys)) {
    console.log(
      `${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`,
    );
    if (!check.ok) code = 1;
  }
} catch (error) {
  code = 1;
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.end().catch(() => {});
}
process.exit(code);
