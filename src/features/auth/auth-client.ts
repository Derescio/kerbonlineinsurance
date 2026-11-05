import { createAuthClient } from "better-auth/react";

// Better Auth's browser client (4.4). Same origin, so no baseURL: /api/auth on whichever host
// served the page (production, staging, a preview or localhost).
export const authClient = createAuthClient();

/** Turnstile's token goes in this header on sign-up and reset (Better Auth's captcha plugin) */
export const captchaHeaders = (token: string) => ({ "x-captcha-response": token });

/** Only same-site paths, so ?redirect= can't send someone to another site after logging in */
export function safeRedirect(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}
