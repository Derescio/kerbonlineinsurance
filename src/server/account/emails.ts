import { waitUntil } from "@vercel/functions";

import { logSafeError } from "#/server/auth/errors";
import { resendSender, type SendEmail } from "#/server/email/send";
import type { EmailContent } from "#/server/email/templates";
import { getAuthEnv } from "#/server/env";

// How the account emails go out (4.7 call 18): after the commit and after the response, as the
// auth emails do (auth.ts). A failed send is logged by class name only, never shown.

export interface AccountDeps {
  sendEmail: SendEmail;
  /** Keeps work alive after the response (Vercel's waitUntil); tests await it themselves */
  defer: (work: Promise<unknown>) => void;
}

let deps: AccountDeps | undefined;

/** Resend and waitUntil, built on first use so nothing reads the environment at import */
export function accountDeps(): AccountDeps {
  if (deps) return deps;
  const env = getAuthEnv();
  deps = { sendEmail: resendSender(env.RESEND_API_KEY, env.EMAIL_FROM), defer: waitUntil };
  return deps;
}

/** Hands the send to `defer`; the caller has already committed */
export function sendLater(deps: AccountDeps, to: string, content: EmailContent): void {
  const work = deps.sendEmail({ to, ...content }).catch((error: unknown) => {
    console.error("[account] email not sent:", logSafeError(error));
  });
  deps.defer(work);
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "7 December 2026", in UK time */
export function formatClosureDate(date: Date): string {
  return DATE.format(date);
}
