import { describe, expect, it } from "vite-plus/test";

import { SeedConfigError, castEmail, readSeedConfig } from "./guard.ts";
import type { SeedConfigReason } from "./guard.ts";

const valid = {
  DATABASE_URL_UNPOOLED: "postgres://owner:s3cretpw@ep-dev.neon.tech/neondb",
  SEED_DATABASE_HOST: "ep-dev.neon.tech",
  SEED_INBOX: "damionwilson@opsedsolutions.com",
  SEED_PASSWORD: "long-enough-password",
  SEED_TOTP_SECRET: "k3Jd9xQ2mP7vL0aR5tY8wE1nB4cZ6hF2",
  BETTER_AUTH_SECRET: "auth-secret",
};

function reasonOf(env: Record<string, string | undefined>): SeedConfigReason | null {
  try {
    readSeedConfig(env);
    return null;
  } catch (error) {
    if (error instanceof SeedConfigError) return error.reason;
    throw error;
  }
}

describe("readSeedConfig", () => {
  it("reads a valid env", () => {
    const config = readSeedConfig(valid);
    expect(config.host).toBe("ep-dev.neon.tech");
    expect(config.inbox).toEqual({ local: "damionwilson", domain: "opsedsolutions.com" });
    expect(config.authSecret).toBe("auth-secret");
  });

  it("prefers SEED_BETTER_AUTH_SECRET", () => {
    expect(readSeedConfig({ ...valid, SEED_BETTER_AUTH_SECRET: "staging" }).authSecret).toBe(
      "staging",
    );
  });

  it("refuses inside a Vercel build before anything else", () => {
    expect(reasonOf({ VERCEL_TARGET_ENV: "preview" })).toBe("in_vercel_build");
  });

  it("refuses a missing or malformed URL", () => {
    expect(reasonOf({ ...valid, DATABASE_URL_UNPOOLED: undefined })).toBe("no_url");
    expect(reasonOf({ ...valid, DATABASE_URL_UNPOOLED: "postgres://u:pw@host:abc/x" })).toBe(
      "bad_url",
    );
  });

  it("never puts the connection string in the message", () => {
    try {
      readSeedConfig({ ...valid, DATABASE_URL_UNPOOLED: "postgres://u:pw@host:abc/x" });
    } catch (error) {
      expect((error as Error).message).not.toContain("postgres://");
      expect((error as Error).message).not.toContain("pw");
    }
  });

  it("refuses a host other than SEED_DATABASE_HOST", () => {
    expect(reasonOf({ ...valid, SEED_DATABASE_HOST: undefined })).toBe("no_target_host");
    expect(
      reasonOf({ ...valid, DATABASE_URL_UNPOOLED: "postgres://o:p@ep-prod.neon.tech/neondb" }),
    ).toBe("wrong_host");
  });

  it("refuses a bad inbox", () => {
    expect(reasonOf({ ...valid, SEED_INBOX: "no-at-sign" })).toBe("bad_inbox");
    expect(reasonOf({ ...valid, SEED_INBOX: "a+b@example.com" })).toBe("bad_inbox");
  });

  it("refuses a password under 10 characters", () => {
    expect(reasonOf({ ...valid, SEED_PASSWORD: "short" })).toBe("short_password");
  });

  it("refuses a TOTP secret that isn't 32 letters and digits", () => {
    expect(reasonOf({ ...valid, SEED_TOTP_SECRET: valid.SEED_TOTP_SECRET.slice(1) })).toBe(
      "bad_totp_secret",
    );
    expect(reasonOf({ ...valid, SEED_TOTP_SECRET: `${valid.SEED_TOTP_SECRET.slice(1)}-` })).toBe(
      "bad_totp_secret",
    );
  });

  it("refuses without an auth secret", () => {
    expect(reasonOf({ ...valid, BETTER_AUTH_SECRET: undefined })).toBe("no_auth_secret");
  });
});

describe("castEmail", () => {
  it("plus-addresses the inbox, lower case", () => {
    expect(castEmail({ local: "DamionWilson", domain: "OpsEdSolutions.com" }, "customer-a")).toBe(
      "damionwilson+customer-a@opsedsolutions.com",
    );
  });
});
