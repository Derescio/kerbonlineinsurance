import type { AuthEnv } from "#/server/env";

// Where Better Auth lives in each environment (plan/engineering.md sections 2 and 7).
export const PRODUCTION_URL = "https://kerbonlineinsurance.vercel.app";
export const STAGING_URL = "https://kerbonlineinsurance-staging.vercel.app";
export const LOCAL_URL = "http://localhost:3000";
// This project's preview deploys only, never every *.vercel.app (4.4, decision 8)
export const PREVIEW_ORIGIN_PATTERN =
  "https://kerbonlineinsurance-*-damion-wilsons-projects.vercel.app";

export interface AuthUrls {
  baseURL: string;
  trustedOrigins: string[];
  /** Previews send Google's callback through staging, which has a registered redirect URI */
  oauthProxy: { productionURL: string; currentURL: string } | null;
}

type UrlEnv = Pick<AuthEnv, "BETTER_AUTH_URL" | "VERCEL_TARGET_ENV" | "VERCEL_URL">;

export function authUrls(env: UrlEnv): AuthUrls {
  const target = env.VERCEL_TARGET_ENV;
  const baseURL = env.BETTER_AUTH_URL ?? (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : LOCAL_URL);

  if (target === "preview") {
    return {
      baseURL,
      trustedOrigins: [baseURL, PREVIEW_ORIGIN_PATTERN],
      oauthProxy: { productionURL: STAGING_URL, currentURL: baseURL },
    };
  }
  if (target === "staging") {
    return {
      baseURL,
      trustedOrigins: [baseURL],
      oauthProxy: { productionURL: STAGING_URL, currentURL: baseURL },
    };
  }
  return { baseURL, trustedOrigins: [baseURL], oauthProxy: null };
}
