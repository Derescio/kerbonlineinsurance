import { getDb } from "#/server/db/client";

import { createAuth } from "./auth";

// For Better Auth's CLI only (4.2, decision 1), which needs a module exporting `auth`. Regenerate
// the auth tables after changing the models in auth.ts, with a throwaway DATABASE_URL (the CLI
// loads the config but doesn't connect):
//   pnpm dlx auth@<better-auth version> generate --config src/server/auth/cli.ts --output <tmp file>
// then carry the changes listed at the top of src/server/db/schema/auth.ts across.
const placeholder = "cli-placeholder-cli-placeholder-cli-placeholder";

export const auth = createAuth({
  db: getDb(),
  env: {
    BETTER_AUTH_SECRET: placeholder,
    GOOGLE_CLIENT_ID: placeholder,
    GOOGLE_CLIENT_SECRET: placeholder,
    RESEND_API_KEY: placeholder,
    EMAIL_FROM: "cli@example.com",
    TURNSTILE_SECRET_KEY: placeholder,
  },
  sendEmail: async () => {},
});
