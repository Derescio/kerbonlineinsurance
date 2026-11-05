import { describe, expect, it } from "vite-plus/test";

import { notFound, redirect } from "@tanstack/react-router";

import { AuthzError, logSafeError, publicErrorFor, toPublicError } from "./errors";

describe("AuthzError", () => {
  it("maps each code to its status", () => {
    expect(new AuthzError("UNAUTHENTICATED").status).toBe(401);
    expect(new AuthzError("FORBIDDEN").status).toBe(403);
    expect(new AuthzError("NOT_FOUND").status).toBe(404);
    expect(new AuthzError("CONFLICT_OF_INTEREST").status).toBe(403);
  });
});

describe("toPublicError", () => {
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
