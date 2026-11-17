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

type UrlEnv = Pick<
  AuthEnv,
  "BETTER_AUTH_URL" | "VERCEL_TARGET_ENV" | "VERCEL_URL" | "VERCEL_BRANCH_URL"
>;

export function authUrls(env: UrlEnv): AuthUrls {
  const target = env.VERCEL_TARGET_ENV;
  // A preview has two addresses: its branch link, which the PR links to, and its own deploy URL.
  // Sign-in lives on the branch link, so Google and the email links come back to the address a
  // visitor started on, where the tab holds their quote (5.7 manual check). Staging and Production
  // have one address, set in BETTER_AUTH_URL.
  const deployURL =
    target === "preview" && env.VERCEL_BRANCH_URL ? env.VERCEL_BRANCH_URL : env.VERCEL_URL;
  const baseURL = env.BETTER_AUTH_URL ?? (deployURL ? `https://${deployURL}` : LOCAL_URL);

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
