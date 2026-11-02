import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// Locally, `vp run db:migrate` targets the `dev` branch from .env.local. On Vercel the variables
// come from the environment (loadEnvFile never overrides a variable that is already set).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Migrations use the direct connection: PgBouncer's transaction mode doesn't keep the session lock
// `drizzle-kit migrate` takes (plan/engineering.md section 3). `generate` and `check` don't connect.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
