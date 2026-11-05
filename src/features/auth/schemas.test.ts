import { describe, expect, it } from "vite-plus/test";

import {
  emailSchema,
  forgotPasswordSchema,
  passwordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";

const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("emailSchema", () => {
  it("trims and lower-cases", () => {
    expect(emailSchema.parse("  Maya.Patel@Example.com ")).toBe("maya.patel@example.com");
  });

  it("refuses a missing or malformed address", () => {
    expect(firstError(emailSchema.safeParse(""))).toBe("Enter your email address.");
    expect(firstError(emailSchema.safeParse("maya@"))).toBe(
      "Enter an email address like name@example.com.",
    );
  });
});

describe("passwordSchema", () => {
  it("refuses 9 characters and accepts 10 (engineering.md §7)", () => {
    expect(firstError(passwordSchema.safeParse("a".repeat(9)))).toBe("Use at least 10 characters.");
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
  });

  it("has no number or uppercase rule (4.3, decision 2)", () => {
    expect(passwordSchema.safeParse("correcthorsebattery").success).toBe(true);
  });

  it("caps the length so a huge body can't tie up the hashing", () => {
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const valid = {
    name: "Maya Patel",
    email: "maya.patel@example.com",
    password: "correcthorsebattery",
    acceptTerms: true,
  };

  it("accepts a complete form", () => {
    expect(signUpSchema.parse(valid)).toEqual(valid);
  });

  it("requires the terms", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, acceptTerms: false }))).toBe(
      "Tick to agree to the terms of use.",
    );
  });

  it("requires a name", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, name: "  " }))).toBe(
      "Enter your full name.",
    );
  });
});

describe("the other forms", () => {
  it("sign in needs an email and any password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(firstError(signInSchema.safeParse({ email: "a@b.co", password: "" }))).toBe(
      "Enter your password.",
    );
  });

  it("forgot password needs an email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  });

  it("reset password uses the same 10-character rule", () => {
    expect(resetPasswordSchema.safeParse({ password: "short" }).success).toBe(false);
  });
});
