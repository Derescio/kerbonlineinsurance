import { describe, expect, it } from "vite-plus/test";

import { checkoutParams } from "#/server/payments/checkout-params";
import { kerbEnv } from "#/server/payments/kerb-env";
import { getStripe } from "#/server/payments/stripe";

const now = new Date("2026-11-14T12:00:00Z");
const base = {
  quoteId: "q_1",
  amountPence: 54321,
  lineName: "Kerb car insurance, Comprehensive, KR24 BXL",
  stripeCustomerId: "cus_1",
  baseUrl: "https://kerb.test",
  now,
};

describe("checkoutParams", () => {
  it("builds an embedded, card-only payment Session for paying in full", () => {
    const p = checkoutParams({ ...base, plan: "annual" });
    expect(p.mode).toBe("payment");
    expect(p.ui_mode).toBe("embedded");
    expect(p.allowed_payment_method_types).toEqual(["card"]);
    expect(p.customer).toBe("cus_1");
    expect(p.expires_at).toBe(Math.floor(now.getTime() / 1000) + 1800);
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items?.[0]?.quantity).toBe(1);
    expect(p.line_items?.[0]?.price_data).toMatchObject({
      currency: "gbp",
      unit_amount: 54321,
      product_data: { name: base.lineName },
    });
    expect(p.line_items?.[0]?.price_data?.recurring).toBeUndefined();
    expect(p.metadata).toMatchObject({ kerb_env: "local", quote_id: "q_1" });
    expect(p.payment_intent_data?.metadata?.kerb_env).toBe("local");
    expect(p.return_url).toBe(
      "https://kerb.test/quote/covered/q_1?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("builds a subscription Session with a monthly interval for paying monthly", () => {
    const p = checkoutParams({ ...base, plan: "monthly", amountPence: 4800 });
    expect(p.mode).toBe("subscription");
    expect(p.line_items?.[0]?.price_data).toMatchObject({
      currency: "gbp",
      unit_amount: 4800,
      recurring: { interval: "month" },
    });
    expect(p.subscription_data?.metadata?.kerb_env).toBe("local");
    expect(p.payment_intent_data).toBeUndefined();
    expect(p.return_url).toContain("{CHECKOUT_SESSION_ID}");
  });
});

describe("kerbEnv", () => {
  it("uses VERCEL_TARGET_ENV when set", () => {
    expect(kerbEnv({ VERCEL_TARGET_ENV: "staging" })).toBe("staging");
    expect(kerbEnv({ VERCEL_TARGET_ENV: "production" })).toBe("production");
    expect(kerbEnv({ VERCEL_TARGET_ENV: "preview" })).toBe("preview");
  });

  it("is local when unset or unrecognised", () => {
    expect(kerbEnv({})).toBe("local");
    expect(kerbEnv({ VERCEL_TARGET_ENV: "development" })).toBe("local");
  });
});

describe("getStripe", () => {
  it("refuses a live key", () => {
    expect(() => getStripe({ STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(
      "Stripe secret key must be a test key (sk_test_…).",
    );
  });

  it("throws when the secret key is missing", () => {
    expect(() => getStripe({})).toThrow(/STRIPE_SECRET_KEY/);
  });
});
