// Confirm and pay's refusal lines (5.6, decision 7), in a module with no imports so the pay page
// can show and match them without pulling the server's payment code into the browser.

export const ACCOUNT_CLOSING = "Your account is closing, so you can’t buy a policy.";
export const ALREADY_BOUGHT = "You’ve already bought this quote.";
export const QUOTE_EXPIRED = "This quote has expired. Get a new quote to see today’s price.";
export const NOT_BUYABLE = "This quote can’t be bought online.";
export const START_DATE_RANGE = "Choose a start date from today up to 30 days ahead.";

/** Under Stripe's form while Kerb is in test mode (5.6b, decision 10) */
export const TEST_CARDS =
  "Test cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined, 4000 0025 0000 3155 asks for 3-D Secure, 4000 0000 0000 0341 fails on a later month.";
