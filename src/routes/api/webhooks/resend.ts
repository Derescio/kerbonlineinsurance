import { createFileRoute } from "@tanstack/react-router";

import { getInboundEnv, handleResendWebhook, resendForwarder } from "#/server/email/inbound";

// Resend's webhook for the hello@ inbox: email.received is forwarded to Gmail
// (src/server/email/inbound.ts). Other events are ignored. POST only, as Resend calls it.

function post({ request }: { request: Request }): Promise<Response> {
  const env = getInboundEnv();
  // The forwarder only runs once env is checked, so the empty key is never used
  return handleResendWebhook(request, env, resendForwarder(env?.apiKey ?? ""));
}

export const Route = createFileRoute("/api/webhooks/resend")({
  server: { handlers: { POST: post } },
});
