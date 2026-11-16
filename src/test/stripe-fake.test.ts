import { describe, expect, it } from "vite-plus/test";

import { fakeStripe } from "#/test/stripe-fake";

describe("fakeStripe", () => {
  it("returns sequential ids, records calls and serves what it created", async () => {
    const stripe = fakeStripe();
    const a = await stripe.checkout.sessions.create({ mode: "payment" });
    const b = await stripe.checkout.sessions.create({ mode: "payment" });
    expect([a.id, b.id]).toEqual(["cs_test_1", "cs_test_2"]);
    expect(a.client_secret).toBe("cs_test_1_secret");
    expect(stripe.calls["checkout.sessions.create"]).toHaveLength(2);
    expect((await stripe.checkout.sessions.retrieve("cs_test_2")).id).toBe("cs_test_2");
    const expired = await stripe.checkout.sessions.expire("cs_test_1");
    expect(expired.status).toBe("expired");
    expect(stripe.calls["checkout.sessions.expire"]).toEqual([["cs_test_1", {}]]);
  });

  it("serves presets, and throws resource_missing for an unknown id", async () => {
    const stripe = fakeStripe();
    stripe.set("subscriptions.retrieve", "sub_1", { status: "active" });
    expect((await stripe.subscriptions.retrieve("sub_1")).status).toBe("active");
    await expect(stripe.invoices.retrieve("in_x")).rejects.toMatchObject({
      code: "resource_missing",
    });
  });

  it("makes a method throw, always or once, optionally only for matching arguments", async () => {
    const stripe = fakeStripe();
    stripe.set("subscriptions.retrieve", "sub_1", {});
    stripe.fail(
      "subscriptions.update",
      new Error("boom"),
      (_id, params) => "cancel_at" in (params as object),
    );
    await expect(stripe.subscriptions.update("sub_1", { cancel_at: 1 })).rejects.toThrow("boom");
    await expect(stripe.subscriptions.update("sub_1", { metadata: {} })).resolves.toBeDefined();
    stripe.failOnce("subscriptions.cancel");
    await expect(stripe.subscriptions.cancel("sub_1")).rejects.toThrow();
    await expect(stripe.subscriptions.cancel("sub_1")).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("lists invoices by subscription and status, as Stripe does, seeing later changes", async () => {
    const stripe = fakeStripe();
    const invoice = (subscription: string, status: string) => ({
      status,
      parent: { subscription_details: { subscription } },
    });
    stripe.set("invoices.retrieve", "in_1", invoice("sub_1", "draft"));
    stripe.set("invoices.retrieve", "in_2", invoice("sub_1", "open"));
    stripe.set("invoices.retrieve", "in_3", invoice("sub_2", "draft"));
    const ids = async (params: object) =>
      (await stripe.invoices.list(params)).data.map((i) => i.id);
    expect(await ids({ subscription: "sub_1", status: "draft" })).toEqual(["in_1"]);
    expect(await ids({ subscription: "sub_1" })).toEqual(["in_1", "in_2"]);
    await stripe.invoices.voidInvoice("in_1");
    expect(await ids({ subscription: "sub_1", status: "draft" })).toEqual([]);
    expect(await ids({ status: "void" })).toEqual(["in_1"]);
  });

  it("delegates webhooks to the real library", () => {
    const stripe = fakeStripe();
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "x" });
    const signer = stripe.webhooks as unknown as {
      generateTestHeaderString(options: object): string;
    };
    const header = signer.generateTestHeaderString({ payload, secret: "whsec_t" });
    expect(stripe.webhooks.constructEvent(payload, header, "whsec_t").id).toBe("evt_1");
  });
});
