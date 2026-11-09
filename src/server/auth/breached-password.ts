import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

// Refuses passwords that appear in Have I Been Pwned (plan/engineering.md section 7). Better Auth
// has a haveIBeenPwned plugin, but it fails closed: when the service is down, sign-up and reset
// return a server error. This one sends the same thing (the first five characters of the SHA-1
// hash, with padding) and fails open, logging that the check was skipped.

export const BREACHED_PASSWORD_MESSAGE = "This password was in a data breach. Try a different one.";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 3000;

// Where each endpoint carries the new password
const PASSWORD_FIELDS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

export type PasswordCheck = "breached" | "clean" | "unavailable";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function checkPassword(
  password: string,
  fetchFn: FetchFn = fetch,
): Promise<PasswordCheck> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetchFn(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Kerb password check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "unavailable";
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [lineSuffix, count] = line.split(":");
      // Padding rows have a count of 0
      if (lineSuffix?.toUpperCase() === suffix && Number(count) > 0) return "breached";
    }
    return "clean";
  } catch {
    return "unavailable";
  }
}

export function breachedPasswordCheck(options: { fetchFn?: FetchFn } = {}): BetterAuthPlugin {
  return {
    id: "kerb-breached-password",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path !== undefined && ctx.path in PASSWORD_FIELDS,
          handler: createAuthMiddleware(async (ctx) => {
            const field = PASSWORD_FIELDS[ctx.path];
            const password = field
              ? (ctx.body as Record<string, unknown> | undefined)?.[field]
              : null;
            if (typeof password !== "string" || password.length === 0) return;
            const result = await checkPassword(password, options.fetchFn);
            if (result === "unavailable") {
              console.warn("[auth] breached-password check skipped: service unavailable");
            }
            if (result === "breached") {
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_COMPROMISED",
                message: BREACHED_PASSWORD_MESSAGE,
              });
            }
          }),
        },
      ],
    },
  };
}
