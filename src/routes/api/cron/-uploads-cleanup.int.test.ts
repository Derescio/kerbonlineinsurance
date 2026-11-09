import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { runUploadsCleanup } from "#/server/uploads/cleanup";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { closeDb } from "#/server/db/client";
import { env } from "#/test/auth";
import { truncateAll } from "#/test/db";

import { Route } from "./uploads-cleanup";

// The real job, with a spy so one test can make it throw
vi.mock("#/server/uploads/cleanup", async (original) => {
  const real = await original<typeof import("#/server/uploads/cleanup")>();
  return { ...real, runUploadsCleanup: vi.fn(real.runUploadsCleanup) };
});

// The daily uploads cleanup's Vercel Cron route (4.10, call 12): a Bearer CRON_SECRET or a 401.

const SECRET = "cron-secret-for-the-integration-tests-0123";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const call = (authorization?: string) =>
  handlers.GET!({
    request: new Request("http://localhost:3000/api/cron/uploads-cleanup", {
      headers: authorization ? { authorization } : {},
    }),
  });

afterAll(closeDb);
beforeEach(async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("CRON_SECRET", SECRET);
  setObjectStore(new MemoryObjectStore());
  await truncateAll();
});
afterEach(() => {
  setObjectStore(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/cron/uploads-cleanup", () => {
  it("answers 401 with no Authorization header", async () => {
    expect((await call()).status).toBe(401);
  });

  it("answers 401 to the wrong secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
  });

  it("runs the job for the right secret and answers with the counts", async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ purged: 0, failed: 0 });
  });

  it("a failing run answers a no-store 500 and logs no raw error", async () => {
    const leak = "claim_photo/user-123/file.webp failed";
    vi.mocked(runUploadsCleanup).mockRejectedValueOnce(new Error(leak));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "failed" });
    expect(logged).toHaveBeenCalledWith("[cron] uploads-cleanup:", { name: "Error" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("user-123");
  });

  it("is GET only", () => {
    expect(Object.keys(handlers)).toEqual(["GET"]);
  });
});
