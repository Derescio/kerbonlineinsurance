import { describe, expect, it } from "vite-plus/test";

import { notFound, redirect } from "@tanstack/react-router";
import { defaultSerovalPlugins, makeSerovalPlugin } from "@tanstack/react-router/ssr/client";
import { fromCrossJSON, toCrossJSONAsync } from "seroval";

import {
  AuthzError,
  IdempotencyConflictError,
  logSafeError,
  PublicError,
  publicErrorAdapter,
  publicErrorFor,
  RateLimitError,
  toPublicError,
} from "./errors";

describe("AuthzError", () => {
  it("maps each code to its status", () => {
    expect(new AuthzError("UNAUTHENTICATED").status).toBe(401);
    expect(new AuthzError("FORBIDDEN").status).toBe(403);
    expect(new AuthzError("NOT_FOUND").status).toBe(404);
    expect(new AuthzError("CONFLICT_OF_INTEREST").status).toBe(403);
  });
});

describe("toPublicError", () => {
  it("passes a PublicError through unchanged", () => {
    const pub = PublicError.from({ code: "FORBIDDEN", status: 403, message: "Nope." });
    expect(toPublicError(pub)).toEqual({ status: 403, code: "FORBIDDEN", message: "Nope." });
    const again = publicErrorFor(pub) as PublicError;
    expect([again.code, again.status, again.message]).toEqual(["FORBIDDEN", 403, "Nope."]);
  });

  it.each([
    ["UNAUTHENTICATED", 401, "Please log in to continue."],
    ["FORBIDDEN", 403, "You don't have access to this."],
    ["NOT_FOUND", 404, "We couldn't find that."],
    [
      "CONFLICT_OF_INTEREST",
      403,
      "You can't work on your own policy, claim or quote. Ask a colleague.",
    ],
  ] as const)("%s", (code, status, message) => {
    expect(toPublicError(new AuthzError(code))).toEqual({ status, code, message });
  });

  it("hides anything else behind a generic 500", () => {
    const error = new Error("select * from users");
    const result = toPublicError(error);
    expect(result).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("select");
    expect(JSON.stringify(result)).not.toContain("stack");
    expect(Object.keys(result).sort()).toEqual(["code", "message", "status"]);
  });

  it("handles non-Error throws", () => {
    expect(toPublicError("boom").code).toBe("INTERNAL");
  });
});

describe("publicErrorFor", () => {
  it("gives an AuthzError its fixed sentence, code and status", () => {
    const out = publicErrorFor(new AuthzError("FORBIDDEN")) as Error & { code: string };
    expect(out.message).toBe("You don't have access to this.");
    expect(out.code).toBe("FORBIDDEN");
    expect((out as unknown as { status: number }).status).toBe(403);
  });

  it("hides a database error behind the generic sentence", () => {
    const out = publicErrorFor(
      new Error('duplicate key value violates unique constraint "x"'),
    ) as Error & { code: string };
    expect(out.message).toBe("Something went wrong. Please try again.");
    expect(out.code).toBe("INTERNAL");
    expect(JSON.stringify(out)).not.toContain("duplicate");
    expect(out.stack ?? "").not.toContain("duplicate");
  });

  it("passes a redirect and a notFound through unchanged", () => {
    const moved = redirect({ to: "/" });
    const missing = notFound();
    expect(publicErrorFor(moved)).toBe(moved);
    expect(publicErrorFor(missing)).toBe(missing);
  });
});

describe("logSafeError", () => {
  it("keeps the name and SQLSTATE of a Drizzle-shaped error and nothing else", () => {
    const cause = Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Key (email)=(maya@example.com) already exists",
    });
    const error = Object.assign(
      new Error("Failed query: insert into users\nparams: maya@example.com,1 Test Street", {
        cause,
      }),
      { name: "DrizzleQueryError" },
    );
    const safe = logSafeError(error);
    expect(safe).toEqual({ name: "DrizzleQueryError", pgCode: "23505" });
    const text = JSON.stringify(safe);
    expect(text).not.toContain("maya@example.com");
    expect(text).not.toContain("Test Street");
  });

  it("reports a non-Error throw as non-error", () => {
    expect(logSafeError("boom")).toEqual({ name: "non-error" });
  });

  it("ignores a code that is not a 5-character SQLSTATE", () => {
    const error = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    expect(logSafeError(error)).toEqual({ name: "Error" });
  });
});

describe("RateLimitError and IdempotencyConflictError", () => {
  it("map to 429 and 409 with fixed sentences", () => {
    expect(toPublicError(new RateLimitError("quote.price"))).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      message: "You're going a bit fast. Try again in a minute.",
    });
    expect(toPublicError(new IdempotencyConflictError())).toEqual({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "This form was already sent with different details. Refresh the page and try again.",
    });
  });

  it("carries the action in the rate-limit message", () => {
    const error = new RateLimitError("quote.price");
    expect(error.action).toBe("quote.price");
    expect(error.message).toBe("rate limited: quote.price");
  });
});

describe("PublicError", () => {
  it("from() builds one with the given fields", () => {
    const error = PublicError.from({ code: "FORBIDDEN", status: 403, message: "x" });
    expect(error).toBeInstanceOf(PublicError);
    expect([error.code, error.status, error.message]).toEqual(["FORBIDDEN", 403, "x"]);
  });
});

describe("publicErrorAdapter round trip", () => {
  const plugins = [makeSerovalPlugin(publicErrorAdapter), ...defaultSerovalPlugins];
  const roundTrip = async (value: unknown) => {
    const json = await toCrossJSONAsync(value, { refs: new Map(), plugins });
    return {
      text: JSON.stringify(json),
      value: fromCrossJSON(json, { refs: new Map(), plugins }) as { error: Error },
    };
  };

  it("keeps the class, code, status and sentence, and no stack or cause", async () => {
    const { text, value } = await roundTrip({ error: new PublicError(new RateLimitError("a")) });
    expect(value.error).toBeInstanceOf(PublicError);
    const error = value.error as PublicError;
    expect([error.code, error.status, error.message]).toEqual([
      "RATE_LIMITED",
      429,
      "You're going a bit fast. Try again in a minute.",
    ]);
    expect(text).not.toContain("stack");
    expect(text).not.toContain("cause");
  });

  it("sends a plain Error as an Error with only its message", async () => {
    const { value } = await roundTrip({ error: new Error("secret detail") });
    expect(value.error).toBeInstanceOf(Error);
    expect(value.error).not.toBeInstanceOf(PublicError);
    expect(value.error.message).toBe("secret detail");
  });
});
