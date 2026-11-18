import { Alert } from "#/components/feedback/Alert";

import { HELP_EMAIL as HELLO } from "./help";

// A car that isn't in the catalogue (5.2, decision 5; call 11). The link names no car and no plate.

const mailto = `mailto:${HELLO}?subject=${encodeURIComponent("Please add my car to Kerb")}`;

export function CarNotListed() {
  return (
    <Alert tone="info" title="We may not have your car yet" announce>
      Kerb is a demo with a limited list of cars. Try choosing another car, or email{" "}
      <a href={mailto}>{HELLO}</a> to ask for a make to be added.
    </Alert>
  );
}
