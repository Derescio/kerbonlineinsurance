import type { CaptureResult, Properties } from "posthog-js";

// The hero form sends the postcode in the URL (/quote?postcode=E8+3RL), and a postcode is personal
// data. PostHog's mask_personal_data_properties covers $current_url and replay URLs, but not
// $referrer, which carries the full URL to the next same-site page. This catches every property.

const postcodeParam = /([?&]postcode=)[^&#\s]*/gi;

export const maskedValue = "<masked>";

function maskProperties(properties: Properties | undefined) {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string") continue;
    const masked = value.replace(postcodeParam, `$1${maskedValue}`);
    if (masked !== value) properties[key] = masked;
  }
}

/** PostHog `before_send`: masks the value of any `postcode=` query param in the event. */
export function maskPostcode(event: CaptureResult): CaptureResult {
  maskProperties(event.properties);
  maskProperties(event.$set);
  maskProperties(event.$set_once);
  return event;
}
