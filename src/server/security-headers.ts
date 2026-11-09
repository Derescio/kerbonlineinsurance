// Security headers. See plan/engineering.md section 9.
//
// The static set goes on every response, including static files, via Nitro route rules in
// vite.config.ts. The CSP needs a fresh nonce per request (TanStack injects inline hydration
// scripts), so src/start.ts sets it in request middleware.

import { r2Origin } from "./uploads/origin";

export const staticSecurityHeaders = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Legacy twin of frame-ancestors for old browsers
  "X-Frame-Options": "DENY",
  // Live camera access stays off: a phone's file picker still offers the camera without it (4.10)
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
} as const;

export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Origins posthog-js loads scripts from and sends data to. On PostHog Cloud that's the region's
 * ingestion host plus its `-assets` twin (see posthog-js RequestRouter); a reverse proxy serves
 * both from the one host. A same-origin proxy path (`/ingest`) is already covered by 'self'.
 */
export function posthogOrigins(host: string | undefined): string[] {
  if (!host || !URL.canParse(host)) return [];
  const { origin, hostname } = new URL(host);
  const region = /^(us|eu)\.i\.posthog\.com$/.exec(hostname)?.[1];
  return region ? [origin, `https://${region}-assets.i.posthog.com`] : [origin];
}

/** Cloudflare Turnstile on sign-up and reset (4.4): its script, and the widget's iframe */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * `r2AccountId` adds that environment's R2 endpoint (4.10): uploads PUT to it, and thumbnails and
 * opened files load from it. Only the one account's origin, never a wildcard.
 */
export function contentSecurityPolicy(nonce: string, posthogHost?: string, r2AccountId?: string) {
  const posthogSource = posthogOrigins(posthogHost)
    .map((origin) => ` ${origin}`)
    .join("");
  const r2 = r2Origin(r2AccountId);
  const r2Source = r2 ? ` ${r2}` : "";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE_ORIGIN}${posthogSource}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // React renders `style` props as attributes in server HTML. Attributes can't run script, and
    // img-src/font-src stop them loading anything off-site. <style> and stylesheets stay strict.
    "style-src-attr 'unsafe-inline'",
    // blob: previews a picked photo before it uploads
    `img-src 'self' data: blob:${r2Source}`,
    "font-src 'self'",
    `connect-src 'self'${posthogSource}${r2Source}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
