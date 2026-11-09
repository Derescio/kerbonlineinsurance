import { z } from "zod";

import {
  accountClosedEmail,
  accountDeletedEmail,
  closureCancelledEmail,
  closureHeldEmail,
  closureRequestedEmail,
  existingAccountEmail,
  resetPasswordEmail,
  verifyEmail,
  type EmailContent,
} from "./templates";

// Every email Kerb sends, by name (4.11, spec call 7). An email job stores the name and its
// parameters, not the message, and the message is built when the job runs.

const nameAndUrl = z.object({ name: z.string(), url: z.string() });
const none = z.object({});

/** Checks the parameters, then builds the message */
function entry<S extends z.ZodType>(
  params: S,
  build: (p: z.infer<S>) => EmailContent,
): (raw: Record<string, string>) => EmailContent {
  return (raw) => build(params.parse(raw));
}

export const EMAIL_TEMPLATES = {
  verify_email: entry(nameAndUrl, verifyEmail),
  reset_password: entry(nameAndUrl, resetPasswordEmail),
  existing_account: entry(nameAndUrl, existingAccountEmail),
  account_deleted: entry(none, accountDeletedEmail),
  closure_requested: entry(z.object({ closesOn: z.string() }), closureRequestedEmail),
  closure_cancelled: entry(none, closureCancelledEmail),
  closure_held: entry(z.object({ claimReference: z.string() }), closureHeldEmail),
  account_closed: entry(none, accountClosedEmail),
};

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;

export const EMAIL_TEMPLATE_NAMES = Object.keys(EMAIL_TEMPLATES) as [
  EmailTemplate,
  ...EmailTemplate[],
];

/** Builds the message; throws on missing or wrong parameters */
export function renderEmail(template: EmailTemplate, params: Record<string, string>): EmailContent {
  return EMAIL_TEMPLATES[template](params);
}
