import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RateLimitError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { rateLimits } from "#/server/db/schema";
import { tamper, truncateAll } from "#/test/db";

import { limit } from "./rate-limit";

const DAY = { max: 3, windowSeconds: 86400 };

describe("limit", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await truncateAll();
  });
  afterEach(() => warn.mockRestore());
  afterAll(closeDb);

  it("allows max calls and refuses the next", async () => {
    for (let i = 0; i < 3; i++) await limit("a:1", DAY);
    await expect(limit("a:1", DAY)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("keeps keys apart", async () => {
    for (let i = 0; i < 3; i++) await limit("a:1", DAY);
    await expect(limit("a:2", DAY)).resolves.toBeUndefined();
  });

  it("lets exactly max of 20 concurrent calls through", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => limit("a:1", { max: 10, windowSeconds: 86400 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  });

  it("counts a refused attempt", async () => {
    for (let i = 0; i < 5; i++) await limit("a:1", DAY).catch(() => undefined);
    const rows = await getDb().select().from(rateLimits).where(eq(rateLimits.key, "a:1"));
    expect(rows.map((r) => r.count)).toEqual([5]);
  });

  it("counts a busy previous window", async () => {
    await tamper(
      `insert into rate_limits (key, window_start, count)
       values ('a:1', date_bin(make_interval(secs => 86400), now(), 'epoch'::timestamptz) - make_interval(secs => 86400), 1000000000)`,
    );
    await expect(limit("a:1", DAY)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("ignores a window two back", async () => {
    await tamper(
      `insert into rate_limits (key, window_start, count)
       values ('a:1', date_bin(make_interval(secs => 86400), now(), 'epoch'::timestamptz) - make_interval(secs => 172800), 1000)`,
    );
    await expect(limit("a:1", DAY)).resolves.toBeUndefined();
  });

  it("warns with the action only", async () => {
    for (let i = 0; i < 4; i++) await limit("a:secret-subject", DAY).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[rate-limit]", "a");
  });
});
