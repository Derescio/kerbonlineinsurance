import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vite-plus/test";

import { maskPostcode } from "#/lib/mask-postcode";

function event(parts: Partial<CaptureResult>): CaptureResult {
  return { uuid: "1", event: "$pageview", properties: {}, ...parts };
}

describe("maskPostcode", () => {
  it("masks the postcode in the page URL and the referrer", () => {
    const result = maskPostcode(
      event({
        properties: {
          $current_url: "https://kerb.example/quote?postcode=E8+3RL",
          $referrer: "https://kerb.example/quote?type=car&postcode=SW1A%201AA#top",
          $pathname: "/quote",
        },
      }),
    );
    expect(result.properties).toEqual({
      $current_url: "https://kerb.example/quote?postcode=<masked>",
      $referrer: "https://kerb.example/quote?type=car&postcode=<masked>#top",
      $pathname: "/quote",
    });
  });

  it("masks person properties too", () => {
    const result = maskPostcode(
      event({
        $set: { $current_url: "https://kerb.example/quote?postcode=E8+3RL" },
        $set_once: { $initial_current_url: "https://kerb.example/?postcode=E8+3RL&type=pet" },
      }),
    );
    expect(result.$set).toEqual({ $current_url: "https://kerb.example/quote?postcode=<masked>" });
    expect(result.$set_once).toEqual({
      $initial_current_url: "https://kerb.example/?postcode=<masked>&type=pet",
    });
  });

  it("leaves everything else alone", () => {
    const properties = {
      $current_url: "https://kerb.example/quote?type=car",
      entry_point: "hero_postcode_form",
      count: 3,
    };
    expect(maskPostcode(event({ properties: { ...properties } })).properties).toEqual(properties);
  });
});
