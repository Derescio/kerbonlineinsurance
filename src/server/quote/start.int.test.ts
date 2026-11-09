import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RateLimitError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { events } from "#/server/db/schema";
import { SECRET } from "#/test/auth";
import { truncateAll } from "#/test/db";

import { recordQuoteStart } from "./start";

// quote.started (5.1, call 11): product and district only, once per journey, 30 per IP an hour.

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const IP = "203.0.113.7";
const journeyId = "0195b2c4-7d1e-4a3f-9b2c-5e6f7a8b9c0d";
const input = { product: "car", district: "E8", journeyId, anonymousId: "ph_abc123" } as const;

const rows = () => getDb().select().from(events);

describe("recordQuoteStart", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await truncateAll();
  });
  afterEach(() => warn.mockRestore());
  afterAll(closeDb);

  it("writes one event with the product, district and anonymous id, and nothing else", async () => {
    await expect(recordQuoteStart(input, from(IP), SECRET)).resolves.toEqual({ recorded: true });
    const [row, ...more] = await rows();
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      name: "quote.started",
      userId: null,
      anonymousId: "ph_abc123",
      entityType: "quote_journey",
      entityId: journeyId,
      properties: { product: "car", district: "E8" },
    });
  });

  it("stores no anonymous id without consent", async () => {
    await recordQuoteStart({ ...input, anonymousId: null }, from(IP), SECRET);
    expect((await rows())[0]?.anonymousId).toBeNull();
  });

  it("writes nothing for a second call in the same journey", async () => {
    await recordQuoteStart(input, from(IP), SECRET);
    await expect(recordQuoteStart(input, from(IP), SECRET)).resolves.toEqual({ recorded: false });
    expect(await rows()).toHaveLength(1);
  });

  it("writes one row when two calls in a journey race", async () => {
    const results = await Promise.all([
      recordQuoteStart({ ...input, product: "home" }, from(IP), SECRET),
      recordQuoteStart({ ...input, product: "home" }, from(IP), SECRET),
    ]);
    expect(results.filter((r) => r.recorded)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("refuses the 31st in an hour from one IP, and not another IP", async () => {
    for (let i = 0; i < 30; i++) {
      const id = `0195b2c4-7d1e-4a3f-9b2c-${String(i).padStart(12, "0")}`;
      await recordQuoteStart({ ...input, journeyId: id }, from(IP), SECRET);
    }
    await expect(
      recordQuoteStart({ ...input, journeyId: crypto.randomUUID() }, from(IP), SECRET),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(await rows()).toHaveLength(30);
    await expect(
      recordQuoteStart({ ...input, journeyId: crypto.randomUUID() }, from("198.51.100.4"), SECRET),
    ).resolves.toEqual({ recorded: true });
  });

  it("writes nothing for bad input", async () => {
    for (const bad of [
      { ...input, district: "E8 3RL" },
      { ...input, product: "pet" },
      { ...input, journeyId: "x" },
      { ...input, anonymousId: "" },
      { ...input, extra: "E8 3RL" },
      null,
    ]) {
      await expect(recordQuoteStart(bad, from(IP), SECRET), JSON.stringify(bad)).resolves.toEqual({
        recorded: false,
      });
    }
    expect(await rows()).toEqual([]);
  });
});
