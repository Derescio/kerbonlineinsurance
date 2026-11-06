import { createSerializationAdapter, isNotFound, isRedirect } from "@tanstack/react-router";

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

export type PublicCode = AuthzCode | "RATE_LIMITED" | "IDEMPOTENCY_CONFLICT" | "INTERNAL";

// Both live here, not in their db modules: toPublicError maps them and this file runs in the browser.

/** A rate-limited action (4.5c). `limit()` logs its own refusal. */
export class RateLimitError extends Error {
  readonly action: string;

  constructor(action: string) {
    super(`rate limited: ${action}`);
    this.name = "RateLimitError";
    this.action = action;
  }
}

/** An idempotency key was reused with a different payload (4.5c) */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key reused with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function toPublicError(error: unknown): {
  status: number;
  code: PublicCode;
  message: string;
} {
  if (error instanceof AuthzError) {
    return { status: error.status, code: error.code, message: MESSAGE[error.code] };
  }
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      code: "RATE_LIMITED",
      message: "You're going a bit fast. Try again in a minute.",
    };
  }
  if (error instanceof IdempotencyConflictError) {
    return {
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "This form was already sent with different details. Refresh the page and try again.",
    };
  }
  return { status: 500, code: "INTERNAL", message: "Something went wrong. Please try again." };
}

/** What the browser receives for any failure: a fixed sentence, a code and a status */
export class PublicError extends Error {
  readonly code: PublicCode;
  readonly status: number;

  constructor(error: unknown, pub = toPublicError(error)) {
    super(pub.message);
    this.name = "PublicError";
    this.code = pub.code;
    this.status = pub.status;
  }

  static from(pub: { code: PublicCode; status: number; message: string }): PublicError {
    return new PublicError(undefined, pub);
  }
}

/**
 * Sends a PublicError across the server-function boundary as three fields. Without it TanStack
 * serialises any Error as `new Error(message)` and the code and status are lost.
 */
export const publicErrorAdapter = createSerializationAdapter({
  key: "kerb/PublicError",
  test: (v): v is PublicError => v instanceof PublicError,
  toSerializable: (e) => ({ code: e.code, status: e.status, message: e.message }),
  fromSerializable: (pub) => PublicError.from(pub),
});

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
