import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb } from "#/server/db/client";
import { SECRET } from "#/test/auth";
import { truncateAll } from "#/test/db";

import { findAddressesFor } from "./addresses";

// 5.7, decision 4: the Property step's lookup checks the postcode with postcodes.io (5.2's check)
// and lists made-up addresses in the postcode's district.

const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

const found = (postcode: string, district: string | null) =>
  new Response(
    JSON.stringify({
      status: 200,
      result: {
        postcode,
        outcode: postcode.split(" ")[0],
        admin_district: district,
        region: "London",
        country: "England",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("findAddressesFor", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await truncateAll();
  });
  afterEach(() => warn.mockRestore());
  afterAll(closeDb);

  it("lists addresses in the postcode's district", async () => {
    const fetch = vi.fn(async () => found("E8 3RL", "Hackney"));
    const answer = await findAddressesFor("e8 3rl", headers, { fetch, secret: SECRET });
    expect(answer.result).toBe("found");
    expect(answer.addresses.length).toBeGreaterThanOrEqual(8);
    expect(answer.addresses.every((a) => a.town === "Hackney")).toBe(true);
  });

  it("falls back to the outcode when postcodes.io names no district", async () => {
    const fetch = vi.fn(async () => found("E8 3RL", null));
    const answer = await findAddressesFor("E8 3RL", headers, { fetch, secret: SECRET });
    expect(answer.addresses[0]!.town).toBe("E8");
  });

  it("lists nothing for a postcode that doesn't exist", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(findAddressesFor("ZZ9 9ZZ", headers, { fetch, secret: SECRET })).resolves.toEqual({
      result: "not_found",
      addresses: [],
    });
  });

  it("lists nothing when postcodes.io can't answer", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 500 }));
    await expect(findAddressesFor("E8 3RL", headers, { fetch, secret: SECRET })).resolves.toEqual({
      result: "unavailable",
      addresses: [],
    });
  });
});
