import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Better Auth's browser client (4.4). Same origin, so no baseURL: /api/auth on whichever host
// served the page (production, staging, a preview or localhost).
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

/** Turnstile's token goes in this header on sign-up and reset (Better Auth's captcha plugin) */
export const captchaHeaders = (token: string) => ({ "x-captcha-response": token });

const PROBE_ORIGIN = "https://x.invalid";
const BACKSLASH = String.fromCharCode(92);

/** C0 controls (U+0000 to U+001F) and DEL (U+007F) */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-site paths, so ?redirect= can't send someone to another site after logging in. A
 * backslash or a control character is refused outright: URL parsing reads `/\evil.example` and
 * `/<tab>/evil.example` as `//evil.example`. Then the path must resolve on our own origin.
 */
export function safeRedirect(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes(BACKSLASH) || hasControlCharacter(value)) return fallback;
  try {
    if (new URL(value, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
