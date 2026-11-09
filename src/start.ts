import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

import { posthogApiHost } from "#/lib/analytics";
import { publicErrorAdapter } from "#/server/auth/errors";
import { contentSecurityPolicy, createNonce } from "#/server/security-headers";

// Gives each request a CSP nonce. getRouter() reads it from the global context, and the
// router stamps it on every script it injects.
const cspMiddleware = createMiddleware().server(async ({ next }) => {
  const nonce = createNonce();
  const result = await next({ context: { nonce } });
  // Vite's dev server injects its own inline scripts, so the CSP only applies to builds
  if (!import.meta.env.DEV) {
    result.response.headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy(nonce, posthogApiHost, process.env.R2_ACCOUNT_ID),
    );
  }
  return result;
});

// Server functions (src/features/auth/session.ts and later ones) are same-origin RPC endpoints:
// a call from another site is refused (Sec-Fetch-Site, then Origin, then Referer).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, cspMiddleware],
  serializationAdapters: [publicErrorAdapter],
}));
