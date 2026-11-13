// The demo card form's checks (5.6, decision 5). A real processor would never let the number or
// code reach our server; here they're checked, then only the brand and last four go on.

export type CardBrand = "Visa" | "Mastercard" | "Amex" | "Card";
export type CardField = "name" | "number" | "expiry" | "code";

/** The demo card that is declined (5.6, decision 5); it passes the Luhn check */
export const DECLINED_TEST_CARD = "4000000000000002";

export type CardCheck =
  | { ok: true; brand: CardBrand; last4: string }
  | { ok: false; fields: Partial<Record<CardField, string>> };

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function brandOf(digits: string): CardBrand {
  const two = Number(digits.slice(0, 2));
  const four = Number(digits.slice(0, 4));
  if (digits.startsWith("4")) return "Visa";
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return "Mastercard";
  if (two === 34 || two === 37) return "Amex";
  return "Card";
}

/** `today` is `YYYY-MM-DD`; a card is good through the end of its expiry month */
export function checkCard(
  input: { name: string; number: string; expiry: string; code: string },
  today: string,
): CardCheck {
  const fields: Partial<Record<CardField, string>> = {};

  if (!input.name.trim()) fields.name = "Enter the name on the card.";

  const digits = input.number.replace(/\s/g, "");
  if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) fields.number = "Enter a valid card number.";

  const expiry = /^(\d{2})\s*\/\s*(\d{2})$/.exec(input.expiry.trim());
  const month = expiry ? Number(expiry[1]) : 0;
  if (!expiry || month < 1 || month > 12) {
    fields.expiry = "Enter the expiry as MM / YY.";
  } else {
    const year = 2000 + Number(expiry[2]);
    const [ty, tm] = today.split("-").map(Number);
    if (year < ty! || (year === ty && month < tm!)) fields.expiry = "This card has expired.";
  }

  if (!/^\d{3,4}$/.test(input.code.trim())) fields.code = "Enter the 3 or 4 digit security code.";

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, brand: brandOf(digits), last4: digits.slice(-4) };
}
