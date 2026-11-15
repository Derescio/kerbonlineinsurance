// Confirm and pay's refusal lines (5.6, decision 7), in a module with no imports so the pay page
// can show and match them without pulling the server's payment code into the browser.

export const CARD_DECLINED = "Your card was declined. Try another card.";
export const ACCOUNT_CLOSING = "Your account is closing, so you can’t buy a policy.";
export const ALREADY_BOUGHT = "You’ve already bought this quote.";
export const QUOTE_EXPIRED = "This quote has expired. Get a new quote to see today’s price.";
export const NOT_BUYABLE = "This quote can’t be bought online.";
export const START_DATE_RANGE = "Choose a start date from today up to 30 days ahead.";
