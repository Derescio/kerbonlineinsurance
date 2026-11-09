import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SEND_TIMEOUT_MS, withTimeout, type EmailMessage } from "./send";

const message: EmailMessage = { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" };

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a send that finishes in time straight through", async () => {
    const send = vi.fn(async () => {});
    await expect(withTimeout(send)(message)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(message, undefined);
  });

  it("passes the idempotency key on", async () => {
    const send = vi.fn(async () => {});
    await withTimeout(send)(message, { idempotencyKey: "email:1" });
    expect(send).toHaveBeenCalledWith(message, { idempotencyKey: "email:1" });
  });

  it("gives up on a provider that hangs, after 10 seconds", async () => {
    vi.useFakeTimers();
    const hangs = () => new Promise<void>(() => {});
    const sending = withTimeout(hangs)(message);
    const failed = expect(sending).rejects.toThrow("Email provider didn't answer within 10s");
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await failed;
  });

  it("passes the provider's own error on", async () => {
    const refuses = async () => {
      throw new Error("Resend refused the email: rate_limit_exceeded");
    };
    await expect(withTimeout(refuses)(message)).rejects.toThrow("rate_limit_exceeded");
  });
});
