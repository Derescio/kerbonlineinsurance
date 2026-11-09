import { Resend } from "resend";

import type { EmailContent } from "./templates";

export interface EmailMessage extends EmailContent {
  to: string;
}

/** `idempotencyKey`: the email job's key, so a job run twice within 24 hours sends once (4.11) */
export type SendEmail = (
  message: EmailMessage,
  opts?: { idempotencyKey?: string },
) => Promise<void>;

/**
 * How long a send may take. Emails go after the response, so the person never waits on this; it
 * stops a provider that hangs from holding the function open until Vercel ends it. 4.11 adds
 * retries from the jobs table.
 */
export const SEND_TIMEOUT_MS = 10_000;

export function withTimeout(send: SendEmail, ms: number = SEND_TIMEOUT_MS): SendEmail {
  return (message, opts) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Email provider didn't answer within ${ms / 1000}s`)),
        ms,
      );
      send(message, opts)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
}

/**
 * Sends through Resend from EMAIL_FROM (`Kerb <hello@kerb.opsedsolutions.com>`, 4.4 decision 1).
 * Throws on failure or timeout; callers run it after the response and log the error
 * (src/server/auth/auth.ts).
 */
export function resendSender(apiKey: string, from: string): SendEmail {
  const resend = new Resend(apiKey);
  return withTimeout(async ({ to, subject, html, text }, opts) => {
    const { error } = await resend.emails.send(
      { from, to, subject, html, text },
      opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
    if (error) throw new Error(`Resend refused the email: ${error.name}`);
  });
}
