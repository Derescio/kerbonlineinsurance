import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  forwardMessage,
  getInboundEnv,
  handleResendWebhook,
  type InboundEnv,
  type ReceivedAttachment,
  type ReceivedEmail,
} from "./inbound";

// The hello@ inbox: Resend's email.received webhook, forwarded to Gmail. Signed the way Resend
// signs (Standard Webhooks: HMAC-SHA256 over "id.timestamp.body" with the whsec_ secret's bytes).

const KEY = Buffer.from("webhook-secret-for-the-tests-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;

const env: InboundEnv = {
  apiKey: "re_receiving",
  webhookSecret: SECRET,
  forwardTo: "inbox@example.com",
  from: "Kerb <hello@example.com>",
};

function signed(body: object, secret: Buffer = KEY): Request {
  const payload = JSON.stringify(body);
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return new Request("http://localhost:3000/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body: payload,
  });
}

const received = {
  type: "email.received",
  created_at: "2026-11-09T10:00:00.000Z",
  data: {
    email_id: "em_123",
    from: "someone@example.com",
    to: ["hello@example.com"],
    received_for: ["hello@example.com"],
  },
};

describe("handleResendWebhook", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards a received email to the inbox, keyed on its id", async () => {
    const forward = vi.fn(async () => {});
    const response = await handleResendWebhook(signed(received), env, forward);
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledWith({
      emailId: "em_123",
      to: "inbox@example.com",
      from: "Kerb <hello@example.com>",
    });
  });

  it("answers 401 to a bad signature and forwards nothing", async () => {
    const forward = vi.fn(async () => {});
    const response = await handleResendWebhook(
      signed(received, Buffer.from("someone-else")),
      env,
      forward,
    );
    expect(response.status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
  });

  it("answers 401 with no signature headers", async () => {
    const forward = vi.fn(async () => {});
    const request = new Request("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      body: JSON.stringify(received),
    });
    expect((await handleResendWebhook(request, env, forward)).status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
  });

  it("answers 200 to other events and ignores them", async () => {
    const forward = vi.fn(async () => {});
    const sent = { type: "email.sent", created_at: "", data: { email_id: "em_9" } };
    expect((await handleResendWebhook(signed(sent), env, forward)).status).toBe(200);
    expect(forward).not.toHaveBeenCalled();
  });

  it("ignores mail for the account's other domains: Resend sends every domain's mail to every webhook", async () => {
    const forward = vi.fn(async () => {});
    const other = {
      ...received,
      data: {
        ...received.data,
        to: ["hello@other.example.com"],
        received_for: ["hello@other.example.com"],
      },
    };
    expect((await handleResendWebhook(signed(other), env, forward)).status).toBe(200);
    expect(forward).not.toHaveBeenCalled();
  });

  it("forwards when the domain only matches on received_for (a Bcc)", async () => {
    const forward = vi.fn(async () => {});
    const bcc = { ...received, data: { ...received.data, to: ["someone@else.example.com"] } };
    await handleResendWebhook(signed(bcc), env, forward);
    expect(forward).toHaveBeenCalledOnce();
  });

  it("answers 500 when the forward fails, so Resend retries, and logs no addresses", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const forward = vi.fn(async () => {
      throw new Error("refused for someone@example.com");
    });
    const response = await handleResendWebhook(signed(received), env, forward);
    expect(response.status).toBe(500);
    expect(JSON.stringify(error.mock.calls)).not.toContain("@");
    expect(JSON.stringify(error.mock.calls)).toContain("em_123");
  });

  it("answers 503 when receiving isn't set up", async () => {
    const forward = vi.fn(async () => {});
    expect((await handleResendWebhook(signed(received), null, forward)).status).toBe(503);
  });
});

describe("getInboundEnv", () => {
  const full = {
    RESEND_RECEIVING_API_KEY: " re_receiving ",
    RESEND_WEBHOOK_SECRET: SECRET,
    CONTACT_INBOX_EMAIL: "inbox@example.com",
    EMAIL_FROM: "Kerb <hello@example.com>",
  };

  it("reads and trims the four values", () => {
    expect(getInboundEnv(full)).toEqual(env);
  });

  it.each(Object.keys(full))("is null without %s", (name) => {
    expect(getInboundEnv({ ...full, [name]: undefined })).toBeNull();
  });
});

describe("forwardMessage", () => {
  const email: ReceivedEmail = {
    from: "Sam <sam@example.com>",
    reply_to: null,
    subject: "Add a Lotus Elise?",
    html: "<p>Hi</p>",
    text: "Hi",
  };
  const request = { emailId: "em_123", to: "inbox@example.com", from: "Kerb <hello@example.com>" };

  it("sends from hello@ with Reply-To the original sender, so a reply in Gmail goes to them", () => {
    expect(forwardMessage(email, [], request)).toEqual({
      from: "Kerb <hello@example.com>",
      to: "inbox@example.com",
      replyTo: ["Sam <sam@example.com>"],
      subject: "Add a Lotus Elise?",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("keeps the sender's own Reply-To when they set one", () => {
    const message = forwardMessage({ ...email, reply_to: ["sam@work.example.com"] }, [], request);
    expect(message.replyTo).toEqual(["sam@work.example.com"]);
  });

  it("attaches files by their download link; inline images are already in the html", () => {
    const attachments: ReceivedAttachment[] = [
      {
        filename: "v5c.pdf",
        content_type: "application/pdf",
        content_disposition: "attachment",
        download_url: "https://dl/1",
      },
      {
        filename: "logo.png",
        content_type: "image/png",
        content_disposition: "inline",
        download_url: "https://dl/2",
      },
    ];
    expect(forwardMessage(email, attachments, request).attachments).toEqual([
      { filename: "v5c.pdf", contentType: "application/pdf", path: "https://dl/1" },
    ]);
  });

  it("gives an empty email a subject and a text body, which Resend requires", () => {
    const message = forwardMessage({ ...email, subject: "", html: null, text: null }, [], request);
    expect(message.subject).toBe("(no subject)");
    expect(message.text).toBe("");
  });
});
