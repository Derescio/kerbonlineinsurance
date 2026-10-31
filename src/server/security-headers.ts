// Security headers. See plan/engineering.md section 9.
//
// The static set goes on every response, including static files, via Nitro route rules in
// vite.config.ts. The CSP needs a fresh nonce per request (TanStack injects inline hydration
// scripts), so src/start.ts sets it in request middleware. Later phases add R2 (img-src) and
// Turnstile (script-src, frame-src, connect-src).

export const staticSecurityHeaders = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Legacy twin of frame-ancestors for old browsers
  "X-Frame-Options": "DENY",
  // Camera opens up on the upload pages only, when they land
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

export function contentSecurityPolicy(nonce: string, posthogHost?: string) {
  const posthogSource = posthogOrigins(posthogHost)
    .map((origin) => ` ${origin}`)
    .join("");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${posthogSource}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // React renders `style` props as attributes in server HTML. Attributes can't run script, and
    // img-src/font-src stop them loading anything off-site. <style> and stylesheets stay strict.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${posthogSource}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
