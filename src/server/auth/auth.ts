import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";

import { getDb } from "#/server/db/client";

// Minimal config (4.2, decision 1): it exists so Better Auth's CLI can generate the auth tables in
// src/server/db/schema/auth.ts from exactly what the library reads and writes. Nothing mounts it
// until 4.4, which extends this file. Any change to the models here means re-running the CLI's
// `generate` and then `vp run db:generate`.
export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: "pg", usePlural: true }),
  user: {
    additionalFields: {
      // Seeded demo data (4.9); every synthetic row hangs off a synthetic user (decision 10)
      isSynthetic: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  // Better Auth's own limiter, in Postgres so it holds across function instances
  rateLimit: { storage: "database", modelName: "authRateLimit" },
  plugins: [twoFactor()],
});
