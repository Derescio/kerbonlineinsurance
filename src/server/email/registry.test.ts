import { describe, expect, it } from "vite-plus/test";

import { EMAIL_TEMPLATES, renderEmail, type EmailTemplate } from "./registry";

// Email jobs carry a template name and its parameters; the message is built when it's sent (4.11).

const params = {
  name: "Maya Patel",
  url: "https://x/r",
  closesOn: "7 December 2026",
  claimReference: "KRB-C-90001",
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

  it("refuses missing parameters", () => {
    expect(() => renderEmail("reset_password", { name: "Maya" })).toThrow();
  });
});
