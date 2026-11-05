import { describe, expect, it } from "vite-plus/test";

import { AuthzError, toPublicError } from "./errors";

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
