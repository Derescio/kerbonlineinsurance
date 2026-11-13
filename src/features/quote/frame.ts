// Where the journey frame's Stepper stands (5.4b, decision 4): Your details on the car and home
// steps, Your quote on the car's quote view, Choose cover on Choose cover and the home offer (5.5,
// decision 2), Buy on the gate, Confirm and pay and You're covered (5.6, decision 2), and no Stepper
// before a journey starts (the start page and coming soon) or on Your saved quotes.

/** One Stepper for car and home (5.1, decision 3). Home's property, contents and claims are the
 * three parts of "Your details". */
export const JOURNEY_STEPS = ["Your details", "Your quote", "Choose cover", "Buy"];

export function journeyStepOf(pathname: string, search: { step?: string }): number | null {
  const path = pathname.replace(/\/+$/, "");
  if (/^\/quote\/(pay|covered)\/[^/]+$/.test(path)) return 3;
  if (path !== "/quote/car" && path !== "/quote/home") return null;
  if (search.step === "quote") return 1;
  if (search.step === "buy") return 3;
  return search.step === "cover" || search.step === "add-home" ? 2 : 0;
}
