import { describe, expect, it } from "vite-plus/test";

import { checkCard, DECLINED_TEST_CARD } from "./card";

const today = "2026-11-13";
const good = { name: "A Driver", number: "4242 4242 4242 4242", expiry: "12/28", code: "123" };

describe("checkCard (5.6, decision 5)", () => {
  it("accepts a Visa and keeps only the brand and last four", () => {
    expect(checkCard(good, today)).toEqual({ ok: true, brand: "Visa", last4: "4242" });
  });

  it("recognises Mastercard and Amex, and falls back to Card", () => {
    expect(checkCard({ ...good, number: "5555 5555 5555 4444" }, today)).toMatchObject({
      ok: true,
      brand: "Mastercard",
    });
    expect(checkCard({ ...good, number: "2221 0000 0000 0009" }, today)).toMatchObject({
      brand: "Mastercard",
    });
    expect(checkCard({ ...good, number: "3782 822463 10005", code: "1234" }, today)).toMatchObject({
      ok: true,
      brand: "Amex",
      last4: "0005",
    });
    expect(checkCard({ ...good, number: "6011 1111 1111 1117" }, today)).toMatchObject({
      ok: true,
      brand: "Card",
    });
  });

  it("accepts the declined test card as a valid number", () => {
    expect(checkCard({ ...good, number: DECLINED_TEST_CARD }, today)).toMatchObject({ ok: true });
  });

  it("rejects a number that fails the Luhn check or is the wrong length", () => {
    const bad = checkCard({ ...good, number: "4242424242424241" }, today);
    expect(bad).toEqual({ ok: false, fields: { number: "Enter a valid card number." } });
    expect(checkCard({ ...good, number: "4242" }, today)).toMatchObject({ ok: false });
    expect(checkCard({ ...good, number: "4242 4242 abcd 4242" }, today)).toMatchObject({
      ok: false,
    });
  });

  it("rejects an expired card and accepts the current month", () => {
    expect(checkCard({ ...good, expiry: "10/26" }, today)).toEqual({
      ok: false,
      fields: { expiry: "This card has expired." },
    });
    expect(checkCard({ ...good, expiry: "11/26" }, today)).toMatchObject({ ok: true });
    expect(checkCard({ ...good, expiry: "11 / 26" }, today)).toMatchObject({ ok: true });
  });

  it("rejects an expiry that isn't MM/YY", () => {
    for (const expiry of ["", "13/28", "00/28", "1/28", "12-28"]) {
      expect(checkCard({ ...good, expiry }, today)).toMatchObject({
        ok: false,
        fields: { expiry: "Enter the expiry as MM / YY." },
      });
    }
  });

  it("checks the security code and the name", () => {
    expect(checkCard({ ...good, code: "12" }, today)).toEqual({
      ok: false,
      fields: { code: "Enter the 3 or 4 digit security code." },
    });
    expect(checkCard({ ...good, code: "12345" }, today)).toMatchObject({ ok: false });
    expect(checkCard({ ...good, name: "  " }, today)).toEqual({
      ok: false,
      fields: { name: "Enter the name on the card." },
    });
  });
});
