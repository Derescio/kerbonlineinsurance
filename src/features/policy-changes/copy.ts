// The words a policy change's refusals and outcomes use (6.3b), shared by the server and dialogs

export const CANT_CHANGE_ONLINE = "We can't make this change online.";
export const PRICE_CHANGED = "The price has changed";
export const CHANGE_WAITING =
  "You have a change waiting for payment. Finish paying for it or cancel it first.";
export const CHANGE_GONE = "This change can't be confirmed any more. Please start again.";
export const POLICY_UPDATED = "Your policy's been updated";
export const REFUNDED_AFTER_CHANGE =
  "Your policy changed while you were paying, so we've refunded you. Please try again.";
export const APPLIES_FROM_TODAY = "The change applies from today. There's no admin fee.";

export const homeWarning = (addressLine1: string) =>
  `Your home insurance isn't changed. It still covers ${addressLine1}.`;
