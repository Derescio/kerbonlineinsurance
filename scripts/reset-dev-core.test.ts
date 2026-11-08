import { describe, expect, it } from "vite-plus/test";

import { confirmedHost } from "./reset-dev-core.ts";

describe("confirmedHost", () => {
  const host = "ep-dev-123.eu-west-2.aws.neon.tech";

  it("accepts --confirm with the exact host", () => {
    expect(confirmedHost(host, ["--confirm", host])).toBe(true);
    expect(confirmedHost(host, [`--confirm=${host}`])).toBe(true);
  });

  it("refuses no flag, another host, or a prefix of it", () => {
    expect(confirmedHost(host, [])).toBe(false);
    expect(confirmedHost(host, ["--confirm", "ep-prod-456.eu-west-2.aws.neon.tech"])).toBe(false);
    expect(confirmedHost(host, ["--confirm", "ep-dev-123"])).toBe(false);
    expect(confirmedHost(host, ["--confirm"])).toBe(false);
  });
});
