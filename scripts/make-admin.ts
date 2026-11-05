import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import pg from "pg";

import { databaseHost } from "./database-host.ts";
import { MakeAdminError, makeAdmin } from "./make-admin-core.ts";
import type { MakeAdminReason } from "./make-admin-core.ts";

// The first admin is made from the command line, never the UI (4.5):
//   pnpm auth:make-admin <email> --name "<display name>"
const messages: Record<MakeAdminReason, string> = {
  no_user: "No user with that email. They must sign up first.",
  unverified: "That user has not verified their email yet.",
  already_staff: "That user is already staff.",
  bad_name: 'A display name is required: --name "<display name>".',
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" } },
});

// Locally the URL comes from .env.local (Neon `dev`), as in drizzle.config.ts. A DATABASE_URL already
// set in the shell wins (loadEnvFile never overrides), so `prod` is an explicit choice.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const email = positionals[0];
const url = process.env.DATABASE_URL;

if (!email) {
  console.error('Usage: auth:make-admin <email> --name "<display name>"');
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
  const { staffCode } = await makeAdmin(client, email, values.name ?? "");
  console.log(`${email.trim().toLowerCase()} is now an admin (${staffCode})`);
} catch (error) {
  code = 1;
  if (error instanceof MakeAdminError) console.error(messages[error.reason]);
  else console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.end().catch(() => {});
}
process.exit(code);
