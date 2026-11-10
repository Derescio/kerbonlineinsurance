import { Resend, type CreateEmailOptions } from "resend";

import { logSafeError } from "#/server/auth/errors";

// The hello@ inbox: Resend receives mail for kerb.opsedsolutions.com (MX at Namecheap) and posts
// email.received here; we resend each email to Gmail with Reply-To the sender, so a reply in Gmail
// goes to them. Resend's own forward() sets no Reply-To, so a reply came back to hello@.
// Resend posts every received email on the account to every webhook, opsedsolutions.com's too,
// so only mail addressed to EMAIL_FROM's domain is forwarded.
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

/** The parts of a received email (`emails.receiving.get`) the forward copies */
export interface ReceivedEmail {
  from: string;
  reply_to: string[] | null;
  subject: string;
  html: string | null;
  text: string | null;
}

/** One entry of `emails.receiving.attachments.list` */
export interface ReceivedAttachment {
  filename?: string;
  content_type: string;
  content_disposition: "inline" | "attachment";
  download_url: string;
}

/**
 * The email Gmail gets. Inline images come back in `html` as data: URIs, so only real
 * attachments are attached, by their (short-lived) download link.
 */
export function forwardMessage(
  email: ReceivedEmail,
  attachments: ReceivedAttachment[],
  request: ForwardRequest,
): CreateEmailOptions {
  const files = attachments
    .filter((file) => file.content_disposition === "attachment")
    .map((file) => ({
      filename: file.filename,
      contentType: file.content_type,
      path: file.download_url,
    }));
  return {
    from: request.from,
    to: request.to,
    replyTo: email.reply_to?.length ? email.reply_to : [email.from],
    subject: email.subject || "(no subject)",
    ...(email.html ? { html: email.html } : {}),
    // Resend needs a body; an empty email gets an empty text one
    text: email.text ?? (email.html ? undefined : ""),
    ...(files.length > 0 ? { attachments: files } : {}),
  } as CreateEmailOptions;
}

/**
 * Reads the received email and its attachments, then sends the copy, keyed on the received
 * email's id, so a webhook Resend retries (or a second delivery of the event) sends once.
 */
export function resendForwarder(apiKey: string): ForwardEmail {
  return async (request) => {
    const resend = new Resend(apiKey);
    const email = await resend.emails.receiving.get(request.emailId);
    if (email.error) throw new Error(`Resend couldn't read the email: ${email.error.name}`);
    const attachments = email.data.attachments.length
      ? await resend.emails.receiving.attachments.list({ emailId: request.emailId })
      : null;
    if (attachments?.error) {
      throw new Error(`Resend couldn't list the attachments: ${attachments.error.name}`);
    }
    const { error } = await resend.emails.send(
      forwardMessage(email.data, attachments?.data.data ?? [], request),
      { idempotencyKey: `forward:${request.emailId}` },
    );
    if (error) throw new Error(`Resend refused the forward: ${error.name}`);
  };
}

/** The domain part of EMAIL_FROM (`Kerb <hello@kerb.opsedsolutions.com>`), lower case */
function domainOf(address: string): string {
  return address
    .replace(/^.*<|>.*$/g, "")
    .split("@")
    .pop()!
    .trim()
    .toLowerCase();
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

  const domain = domainOf(env.from);
  const recipients = [...event.data.to, ...(event.data.received_for ?? [])];
  if (!recipients.some((address) => domainOf(address) === domain)) {
    return Response.json({ ok: true }, { headers: noStore });
  }

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
