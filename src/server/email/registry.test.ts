import { describe, expect, it } from "vite-plus/test";

import { EMAIL_TEMPLATES, renderEmail, type EmailTemplate } from "./registry";

// Email jobs carry a template name and its parameters; the message is built when it's sent (4.11).

const params = {
  name: "Maya Patel",
  url: "https://x/r",
  closesOn: "7 December 2026",
  claimReference: "KRB-C-90001",
  policyReference: "KRB-123456",
  car: "Volkswagen Golf 1.0 TSI Life 5dr · VW21 GQL",
  startsOn: "20 November 2026",
  endsOn: "19 November 2027",
  amount: "£458.40 paid annually",
  reason: "You’d already bought this quote.",
  summary: "Your cover is now Plus.",
  priceLine: "Your price goes up by £4.60 a month",
};

describe("renderEmail", () => {
  it("renders every template", () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual([
      "account_closed",
      "account_deleted",
      "closure_cancelled",
      "closure_held",
      "closure_requested",
      "cover_lapsed",
      "cover_resumed",
      "existing_account",
      "payment_failed",
      "payment_refunded",
      "policy_cancelled_unpaid",
      "policy_changed",
      "policy_confirmed",
      "reset_password",
      "verify_email",
    ]);
    for (const template of Object.keys(EMAIL_TEMPLATES) as EmailTemplate[]) {
      const email = renderEmail(template, params);
      expect(email.subject).not.toBe("");
      expect(email.html).not.toBe("");
      expect(email.text).not.toBe("");
    }
  });

  it("puts the link in the email", () => {
    expect(renderEmail("reset_password", { name: "Maya", url: "https://x/r" }).html).toContain(
      "https://x/r",
    );
  });

  it("confirms a policy with its reference, car, dates, amount and account link (5.6)", () => {
    const email = renderEmail("policy_confirmed", {
      ...params,
      name: "Maya",
      url: "https://x/account",
    });
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Maya");
      expect(part).toContain("KRB-123456");
      expect(part).toContain("Volkswagen Golf 1.0 TSI Life 5dr");
      expect(part).toContain("20 November 2026");
      expect(part).toContain("19 November 2027");
      expect(part).toContain("£458.40 paid annually");
      expect(part).toContain("https://x/account");
    }
  });

  it("names the home on a home or bundle confirmation, and leaves it out otherwise (5.7b)", () => {
    const bundle = renderEmail("policy_confirmed", { ...params, home: "18 Albion Road, LS6 2AB" });
    for (const part of [bundle.html, bundle.text]) {
      expect(part).toContain("Car: Volkswagen Golf");
      expect(part).toContain("Home: 18 Albion Road, LS6 2AB");
    }
    const car = renderEmail("policy_confirmed", { ...params, home: "" });
    expect(car.text).not.toContain("Home:");
    // A job queued before 5.7b has no home at all
    expect(renderEmail("policy_confirmed", params).text).not.toContain("Home:");
  });

  it("tells the customer their policy changed: what, the new price and the policy link (6.3b)", () => {
    const email = renderEmail("policy_changed", {
      name: "Maya",
      policyReference: "KRB-123456",
      summary: "Arjun Patel is now a named driver.",
      priceLine: "Your price goes up by £4.60 a month",
      url: "https://x/account/policies/KRB-123456",
    });
    expect(email.subject).toBe("Your Kerb policy KRB-123456 has changed");
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Maya");
      expect(part).toContain("Arjun Patel is now a named driver.");
      expect(part).toContain("Your price goes up by £4.60 a month");
      expect(part).toContain("https://x/account/policies/KRB-123456");
    }
  });

  it("tells the customer a payment was refunded, why, with the account link (5.6b)", () => {
    const email = renderEmail("payment_refunded", {
      name: "Maya Patel",
      reason: "The amount taken didn’t match your quote.",
      url: "https://x/account",
    });
    expect(email.subject).toBe("We’ve refunded your payment");
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Maya");
      expect(part).toContain("refunded your payment in full");
      expect(part).toContain("The amount taken didn’t match your quote.");
      expect(part).toContain("https://x/account");
    }
    expect(email.html).not.toContain("Patel");
  });

  it("asks for a new card when a monthly payment fails, linking to billing (5.6b)", () => {
    const email = renderEmail("payment_failed", {
      name: "Maya Patel",
      url: "https://x/account/billing",
    });
    expect(email.subject).toBe("We couldn’t take this month’s payment");
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Maya");
      expect(part).toContain("We couldn’t take this month’s payment");
      expect(part).toContain("Update your card so your cover continues.");
      expect(part).toContain("https://x/account/billing");
    }
    expect(email.html).not.toContain("Patel");
  });

  it.each([
    ["cover_lapsed", "You’re no longer covered", "Update your card to resume your cover."],
    ["cover_resumed", "Your cover has resumed", "Your cover has resumed"],
    [
      "policy_cancelled_unpaid",
      "Your policy has been cancelled",
      "because we couldn’t take your payments.",
    ],
  ] as const)("%s: says so, with the billing link (5.6b)", (template, subject, line) => {
    const email = renderEmail(template, { name: "Maya Patel", url: "https://x/account/billing" });
    expect(email.subject).toBe(subject);
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Maya");
      expect(part).toContain(subject);
      expect(part).toContain(line);
      expect(part).toContain("https://x/account/billing");
    }
    expect(email.html).not.toContain("Patel");
  });

  it("refuses missing parameters", () => {
    expect(() => renderEmail("reset_password", { name: "Maya" })).toThrow();
  });
});
