import { databaseHost } from "../database-host.ts";

// What `vp run db:seed` needs, read and checked before it connects (4.9, calls 8, 13, 14). The seed
// only ever writes to Neon `dev`: the URL's host must equal SEED_DATABASE_HOST, and it refuses to
// run inside any Vercel build. Messages name the variable, never its value.

export interface SeedConfig {
  /** DATABASE_URL_UNPOOLED: the owner, like db:reference */
  url: string;
  host: string;
  inbox: { local: string; domain: string };
  password: string;
  totpSecret: string;
  /** Encrypts the staff TOTP secret: SEED_BETTER_AUTH_SECRET, else BETTER_AUTH_SECRET */
  authSecret: string;
}

export type SeedConfigReason =
  | "in_vercel_build"
  | "no_url"
  | "bad_url"
  | "no_target_host"
  | "target_is_url"
  | "wrong_host"
  | "bad_inbox"
  | "short_password"
  | "bad_totp_secret"
  | "no_auth_secret";

const messages: Record<SeedConfigReason, string> = {
  in_vercel_build: "The seed never runs in a Vercel build (VERCEL_TARGET_ENV is set).",
  no_url: "DATABASE_URL_UNPOOLED is not set (the owner connection to Neon dev).",
  bad_url: "DATABASE_URL_UNPOOLED is not a valid URL.",
  no_target_host: "SEED_DATABASE_HOST is not set: the dev branch's direct host, from .env.local.",
  target_is_url:
    "SEED_DATABASE_HOST must be only the host (the part between @ and /, e.g. ep-….neon.tech), not a connection string.",
  wrong_host:
    "SEED_DATABASE_HOST doesn't match DATABASE_URL_UNPOOLED's host: the seed and the reset only write to dev.",
  bad_inbox: "SEED_INBOX must be a plain address (name@domain, no +).",
  short_password: "SEED_PASSWORD must be at least 10 characters.",
  bad_totp_secret: "SEED_TOTP_SECRET must be 32 letters and digits.",
  no_auth_secret: "BETTER_AUTH_SECRET (or SEED_BETTER_AUTH_SECRET) is not set.",
};

export class SeedConfigError extends Error {
  readonly reason: SeedConfigReason;
  constructor(reason: SeedConfigReason) {
    super(messages[reason]);
    this.name = "SeedConfigError";
    this.reason = reason;
  }
}

/** The owner connection, only if it points at Neon `dev` (SEED_DATABASE_HOST) and not in a build */
export function readDevTarget(env: Record<string, string | undefined>): {
  url: string;
  host: string;
} {
  if (env.VERCEL_TARGET_ENV) throw new SeedConfigError("in_vercel_build");

  const url = env.DATABASE_URL_UNPOOLED;
  if (!url) throw new SeedConfigError("no_url");
  const host = databaseHost(url);
  if (!host) throw new SeedConfigError("bad_url");
  if (!env.SEED_DATABASE_HOST) throw new SeedConfigError("no_target_host");
  if (env.SEED_DATABASE_HOST.includes("://")) throw new SeedConfigError("target_is_url");
  if (host !== env.SEED_DATABASE_HOST) throw new SeedConfigError("wrong_host");
  return { url, host };
}

export function readSeedConfig(env: Record<string, string | undefined>): SeedConfig {
  const { url, host } = readDevTarget(env);

  const inbox = /^([^@\s+]+)@([^@\s]+\.[^@\s]+)$/.exec(env.SEED_INBOX ?? "");
  if (!inbox) throw new SeedConfigError("bad_inbox");

  const password = env.SEED_PASSWORD ?? "";
  if (password.length < 10) throw new SeedConfigError("short_password");

  const totpSecret = env.SEED_TOTP_SECRET ?? "";
  if (!/^[A-Za-z0-9]{32}$/.test(totpSecret)) throw new SeedConfigError("bad_totp_secret");

  const authSecret = env.SEED_BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET;
  if (!authSecret) throw new SeedConfigError("no_auth_secret");

  return {
    url,
    host,
    inbox: { local: inbox[1]!, domain: inbox[2]! },
    password,
    totpSecret,
    authSecret,
  };
}

/** A cast member's address: one inbox, a `+suffix` per person (call 8). Better Auth stores lowercase. */
export function castEmail(inbox: SeedConfig["inbox"], suffix: string): string {
  return `${inbox.local}+${suffix}@${inbox.domain}`.toLowerCase();
}
