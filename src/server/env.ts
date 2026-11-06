import { z } from "zod";

import { AuditKeyError, parseKeys, type AuditKeys } from "#/server/audit/chain";

// Server-only environment, validated once at startup so a missing variable fails fast.
// Later phases add: ANTHROPIC_API_KEY, OPENAI_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_SECRET. Auth's variables are below (getAuthEnv).
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

// Auth, email and Turnstile (4.4). Validated on first use rather than at import, so pages that
// never touch auth (the CDN-cached landing page, /system) don't need them, the same way getDb()
// reads DATABASE_URL.
// Values are trimmed: a stray space or tab pasted into Vercel would otherwise break a key
export const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().trim().min(32, "use `openssl rand -base64 32`"),
  // Set on Production and Staging; Preview builds it from VERCEL_URL, so it's unset there
  BETTER_AUTH_URL: z.string().trim().pipe(z.url()).optional(),
  GOOGLE_CLIENT_ID: z.string().trim().min(1),
  GOOGLE_CLIENT_SECRET: z.string().trim().min(1),
  RESEND_API_KEY: z.string().trim().min(1),
  EMAIL_FROM: z.string().trim().min(3),
  TURNSTILE_SECRET_KEY: z.string().trim().min(1),
  // Shared by Staging and Preview only: seals the Google round trip through staging (oAuthProxy)
  OAUTH_PROXY_SECRET: z.string().trim().min(32).optional(),
  // Set by Vercel. VERCEL_TARGET_ENV is "production", "preview" or a custom environment's name
  // ("staging"); VERCEL_ENV says "preview" for custom environments too, so it can't tell them apart.
  VERCEL_TARGET_ENV: z.string().trim().optional(),
  VERCEL_URL: z.string().trim().optional(),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

let authEnv: AuthEnv | undefined;

export function getAuthEnv(source: Record<string, string | undefined> = process.env): AuthEnv {
  if (authEnv && source === process.env) return authEnv;
  const result = authEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid auth environment (.env.example, "Auth (4.4)"):\n${problems}`);
  }
  if (source === process.env) authEnv = result.data;
  return result.data;
}

// Audit HMAC keys (4.5b). Validated on first use, like getAuthEnv. Cached on the raw pair of
// strings rather than on process.env identity, so a changed value (a rotation, or a test) is seen
// and a missing key always throws.
// Named so logSafeError records "AuditConfigError" rather than a bare "Error"
export class AuditConfigError extends Error {
  override name = "AuditConfigError";
  constructor(reason: string) {
    // The reason names a version or a setting, never key material
    super(`Invalid audit environment (.env.example, "Audit (4.5b)"): ${reason}`);
  }
}

let auditCache:
  | { raw: string | undefined; active: string | undefined; keys: AuditKeys }
  | undefined;

export function getAuditEnv(source: Record<string, string | undefined> = process.env): AuditKeys {
  const raw = source.AUDIT_HMAC_KEYS;
  const active = source.AUDIT_HMAC_ACTIVE_VERSION;
  if (auditCache && auditCache.raw === raw && auditCache.active === active) {
    return auditCache.keys;
  }
  try {
    const keys = parseKeys(raw, active);
    auditCache = { raw, active, keys };
    return keys;
  } catch (error) {
    if (error instanceof AuditKeyError) {
      // The reason names a version or a setting, never key material
      throw new AuditConfigError(error.reason);
    }
    throw error;
  }
}
