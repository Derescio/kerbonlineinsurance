import { Resend } from "resend";

import { logSafeError } from "#/server/auth/errors";

// The hello@ inbox: Resend receives mail for kerb.opsedsolutions.com (MX at Namecheap) and posts
// email.received here; we forward each email to Gmail unchanged, so a reply goes to the sender.
// Production and Staging each have their own webhook, signing secret and full-access key: a
// sending-only key can't read received mail, and forwarding has to read it first. The sending key
// (RESEND_API_KEY) stays sending-only. Logs carry the email's id, never an address or subject.

export interface InboundEnv {
  apiKey: string;
  webhookSecret: string;
  forwardTo: string;
  from: string;
}

/** Null when any value is missing: local, CI and previews don't receive mail, and answer 503 */
export function getInboundEnv(
  source: Record<string, string | undefined> = process.env,
): InboundEnv | null {
  const apiKey = source.RESEND_RECEIVING_API_KEY?.trim();
  const webhookSecret = source.RESEND_WEBHOOK_SECRET?.trim();
  const forwardTo = source.CONTACT_INBOX_EMAIL?.trim();
  const from = source.EMAIL_FROM?.trim();
  if (!apiKey || !webhookSecret || !forwardTo || !from) return null;
  return { apiKey, webhookSecret, forwardTo, from };
}

export interface ForwardRequest {
  emailId: string;
  to: string;
  from: string;
}

export type ForwardEmail = (request: ForwardRequest) => Promise<void>;

/**
 * Forwards through Resend, keyed on the received email's id, so a webhook Resend retries (or a
 * second delivery of the same event) forwards once.
 */
export function resendForwarder(apiKey: string): ForwardEmail {
  return async (request) => {
    const { error } = await new Resend(apiKey).emails.receiving.forward(request, {
      idempotencyKey: `forward:${request.emailId}`,
    });
    if (error) throw new Error(`Resend refused the forward: ${error.name}`);
  };
}

const noStore = { "Cache-Control": "no-store" };

export async function handleResendWebhook(
  request: Request,
  env: InboundEnv | null,
  forward: ForwardEmail,
): Promise<Response> {
  if (!env) return Response.json({ error: "not configured" }, { status: 503, headers: noStore });

  // The signature covers the raw body, so read it as text before parsing
  const payload = await request.text();
  let event;
  try {
    event = new Resend(env.apiKey).webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: env.webhookSecret,
    });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }

  if (event.type !== "email.received") return Response.json({ ok: true }, { headers: noStore });

  const emailId = event.data.email_id;
  try {
    await forward({ emailId, to: env.forwardTo, from: env.from });
  } catch (error) {
    // A 500 makes Resend retry; the idempotency key stops a retry forwarding twice
    console.error(`[inbound] forward ${emailId}:`, logSafeError(error));
    return Response.json({ error: "failed" }, { status: 500, headers: noStore });
  }
  return Response.json({ ok: true }, { headers: noStore });
}
