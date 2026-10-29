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

export function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
