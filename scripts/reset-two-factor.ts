import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import pg from "pg";

import { AuditKeyError, parseKeys } from "../src/server/audit/chain.ts";
import { databaseHost } from "./database-host.ts";
import { failureLine, ResetTwoFactorError, resetTwoFactor } from "./reset-two-factor-core.ts";
import type { ResetTwoFactorReason } from "./reset-two-factor-core.ts";

// For a staff member who has lost their phone and their backup codes (4.6, call 12):
//   pnpm auth:reset-two-factor <email>
// Prints the user id, never the email.
const messages: Record<ResetTwoFactorReason, string> = {
  unknown_email: "No user with that email.",
};

const { positionals } = parseArgs({ allowPositionals: true });

// Locally the URL comes from .env.local (Neon `dev`), as in drizzle.config.ts. A DATABASE_URL already
// set in the shell wins (loadEnvFile never overrides), so `prod` is an explicit choice.
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

const email = positionals[0];
const url = process.env.DATABASE_URL;

if (!email) {
  console.error("Usage: auth:reset-two-factor <email>");
  process.exit(1);
}
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
  const { userId } = await resetTwoFactor(client, email, keys);
  console.log(`Two-factor reset for ${userId}.`);
} catch (error) {
  code = 1;
  if (error instanceof ResetTwoFactorError) console.error(messages[error.reason]);
  // Name and SQLSTATE only: a message can carry the email
  else console.error(failureLine(error));
} finally {
  await client.end().catch(() => {});
}
process.exit(code);
