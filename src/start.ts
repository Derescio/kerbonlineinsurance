import { createMiddleware, createStart } from "@tanstack/react-start";

import { contentSecurityPolicy, createNonce } from "#/server/security-headers";

// Gives each request a CSP nonce. getRouter() reads it from the global context, and the
// router stamps it on every script it injects.
const cspMiddleware = createMiddleware().server(async ({ next }) => {
  const nonce = createNonce();
  const result = await next({ context: { nonce } });
  // Vite's dev server injects its own inline scripts, so the CSP only applies to builds
  if (!import.meta.env.DEV) {
    result.response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [cspMiddleware],
}));
