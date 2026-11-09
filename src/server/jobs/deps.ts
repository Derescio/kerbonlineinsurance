import { waitUntil } from "@vercel/functions";

import { resendSender } from "#/server/email/send";
import { getAuthEnv } from "#/server/env";

import type { JobDeps } from "./types";

let deps: JobDeps | undefined;

/** Resend and waitUntil, built on first use so nothing reads the environment at import */
export function jobDeps(): JobDeps {
  if (deps) return deps;
  const env = getAuthEnv();
  deps = { sendEmail: resendSender(env.RESEND_API_KEY, env.EMAIL_FROM), defer: waitUntil };
  return deps;
}
