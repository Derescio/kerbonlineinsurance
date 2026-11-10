import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Db } from "#/server/db/client";
import { closeDb, getDb } from "#/server/db/client";
import { postcodeAreas } from "#/server/db/schema";
import { SECRET } from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";

import { checkPostcodeExists } from "./postcode";

// 5.2, call 15: postcodes.io once per postcode, cached in postcode_areas, 60 lookups per IP an
// hour, and every failure lets the visitor carry on ("unavailable").

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const IP = "203.0.113.7";

const found = (postcode: string) =>
  new Response(
    JSON.stringify({
      status: 200,
      result: {
        postcode,
        outcode: postcode.split(" ")[0],
        admin_district: "Hackney",
        region: "London",
        country: "England",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
const notFound = () =>
  new Response(JSON.stringify({ status: 404, error: "Postcode not found" }), { status: 404 });

const rows = () => getDb().select().from(postcodeAreas);

describe("checkPostcodeExists", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await truncateAll();
  });
  afterEach(() => warn.mockRestore());
  afterAll(closeDb);

  it("asks postcodes.io on a miss and stores the postcode", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => found("E8 3RL"));
    await expect(checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "found",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.postcodes.io/postcodes/E83RL");
    // No time is kept: with one, a row could be matched to a visitor's district-only funnel event
    expect(await rows()).toEqual([
      {
        postcode: "E8 3RL",
        outcode: "E8",
        adminDistrict: "Hackney",
        region: "London",
        country: "England",
      },
    ]);
  });

  it("reads a stored postcode without asking again", async () => {
    const fetch = vi.fn(async () => found("E8 3RL"));
    await checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET });
    await expect(checkPostcodeExists("e8 3rl", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "found",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says not found for a postcode postcodes.io doesn't know, and stores nothing", async () => {
    const fetch = vi.fn(async () => notFound());
    await expect(checkPostcodeExists("ZZ1 1ZZ", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "not_found",
    );
    expect(await rows()).toEqual([]);
  });

  it("says not found for a bad postcode without asking", async () => {
    const fetch = vi.fn(async () => found("E8 3RL"));
    await expect(checkPostcodeExists("hello", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "not_found",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets the visitor carry on when postcodes.io fails or answers oddly", async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => new Response("oops", { status: 500 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response(JSON.stringify({}), { status: 200 }),
      async () => found("N1 9GU"),
      async () => new Response("not json", { status: 200 }),
    ];
    for (const answer of answers) {
      const fetch = vi.fn(answer);
      await expect(
        checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET }),
      ).resolves.toBe("unavailable");
    }
    expect(await rows()).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(
      checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET, timeoutMs: 50 }),
    ).resolves.toBe("unavailable");
  });

  it("skips the check after 60 lookups from one IP, but still reads stored postcodes", async () => {
    await getOwnerDb()
      .insert(postcodeAreas)
      .values({ postcode: "N1 9GU", outcode: "N1", country: "England" });
    const fetch = vi.fn(async () => notFound());
    for (let i = 1; i <= 60; i++) {
      await expect(
        checkPostcodeExists(`E${i} 1AA`, from(IP), { fetch, secret: SECRET }),
      ).resolves.toBe("not_found");
    }
    await expect(checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(60);
    await expect(checkPostcodeExists("N1 9GU", from(IP), { fetch, secret: SECRET })).resolves.toBe(
      "found",
    );
  });

  it("lets the visitor carry on when the database fails", async () => {
    const broken = {
      select() {
        throw new Error("database down");
      },
    } as unknown as Db;
    const fetch = vi.fn(async () => found("E8 3RL"));
    await expect(
      checkPostcodeExists("E8 3RL", from(IP), { fetch, secret: SECRET, db: broken }),
    ).resolves.toBe("unavailable");
  });

  it("can't be changed or emptied by the app role", async () => {
    await getOwnerDb()
      .insert(postcodeAreas)
      .values({ postcode: "E8 3RL", outcode: "E8", country: "England" });
    await expect(
      getDb()
        .update(postcodeAreas)
        .set({ country: "Wales" })
        .where(eq(postcodeAreas.postcode, "E8 3RL")),
    ).rejects.toThrow();
    await expect(getDb().delete(postcodeAreas)).rejects.toThrow();
  });
});
