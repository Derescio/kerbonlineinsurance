import { describe, expect, it } from "vite-plus/test";

import { PublicError } from "#/server/auth/errors";

import { writeOutcome } from "./writes";

describe("writeOutcome", () => {
  it("sends UNAUTHENTICATED to sign in", () => {
    const e = PublicError.from({ code: "UNAUTHENTICATED", status: 401, message: "Please log in." });
    expect(writeOutcome(e)).toEqual({ kind: "sign_in" });
  });

  it("rotates the key on IDEMPOTENCY_CONFLICT", () => {
    const e = PublicError.from({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
      message: "This form was already sent with different details. Refresh the page and try again.",
    });
    expect(writeOutcome(e)).toEqual({
      kind: "message",
      message: "This form was already sent with different details. Refresh the page and try again.",
      rotateKey: true,
    });
  });

  it("shows any other PublicError message and keeps the key", () => {
    const e = PublicError.from({
      code: "RATE_LIMITED",
      status: 429,
      message: "You're going a bit fast. Try again in a minute.",
    });
    expect(writeOutcome(e)).toEqual({
      kind: "message",
      message: "You're going a bit fast. Try again in a minute.",
      rotateKey: false,
    });
  });

  it("gives a generic message for anything else", () => {
    expect(writeOutcome(new TypeError("Failed to fetch"))).toEqual({
      kind: "message",
      message: "Something went wrong. Please try again.",
      rotateKey: false,
    });
  });
});
