import { z } from "zod";

// Server-only environment, validated once at startup so a missing variable fails fast.
// Later phases add: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, RESEND_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_SECRET, TURNSTILE_SITE_KEY,
// TURNSTILE_SECRET_KEY.
export const envSchema = z.object({
  PUBLIC_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(300),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  return result.data;
}

export const env = parseEnv();
