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
};

describe("renderEmail", () => {
  it("renders every template", () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual([
      "account_closed",
      "account_deleted",
      "closure_cancelled",
      "closure_held",
      "closure_requested",
      "existing_account",
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

  it("refuses missing parameters", () => {
    expect(() => renderEmail("reset_password", { name: "Maya" })).toThrow();
  });
});
