import { isNotFound, isRedirect } from "@tanstack/react-router";

// What a failed permission check looks like (4.5). The browser gets a code and a fixed sentence,
// never the original message or a stack trace.

export type AuthzCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT_OF_INTEREST";

const STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT_OF_INTEREST: 403,
} as const satisfies Record<AuthzCode, 401 | 403 | 404>;

const MESSAGE: Record<AuthzCode, string> = {
  UNAUTHENTICATED: "Please log in to continue.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "We couldn't find that.",
  CONFLICT_OF_INTEREST: "You can't work on your own policy, claim or quote. Ask a colleague.",
};

export class AuthzError extends Error {
  readonly code: AuthzCode;
  readonly status: 401 | 403 | 404;

  constructor(code: AuthzCode) {
    super(code);
    this.name = "AuthzError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function toPublicError(error: unknown): {
  status: number;
  code: AuthzCode | "INTERNAL";
  message: string;
} {
  if (error instanceof AuthzError) {
    return { status: error.status, code: error.code, message: MESSAGE[error.code] };
  }
  return { status: 500, code: "INTERNAL", message: "Something went wrong. Please try again." };
}

/** What the browser receives for any failure: a fixed sentence, a code and a status */
export class PublicError extends Error {
  readonly code: AuthzCode | "INTERNAL";
  readonly status: number;

  constructor(error: unknown) {
    const pub = toPublicError(error);
    super(pub.message);
    this.name = "PublicError";
    this.code = pub.code;
    this.status = pub.status;
  }
}

/**
 * The error to throw out of a server function. TanStack redirects and notFound pass through
 * unchanged; everything else becomes a PublicError, so a database message never reaches the browser.
 */
export function publicErrorFor(error: unknown): Error {
  if (isRedirect(error) || isNotFound(error)) return error as unknown as Error;
  return new PublicError(error);
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The only parts of an unexpected error that are safe to log: its class name and, when a Postgres
 * error sits in the cause chain, the SQLSTATE. Never the message (Drizzle puts query parameters
 * in it), the stack, `detail` (it holds the conflicting value) or `cause`.
 */
export function logSafeError(error: unknown): { name: string; pgCode?: string } {
  if (!(error instanceof Error)) return { name: "non-error" };
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SQLSTATE.test(code)) return { name: error.name, pgCode: code };
    current = current.cause;
  }
  return { name: error.name };
}
