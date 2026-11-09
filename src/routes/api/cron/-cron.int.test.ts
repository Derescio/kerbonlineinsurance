import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { jobs } from "#/server/db/schema";
import { DAILY_JOBS } from "#/server/jobs/daily";
import { runDueJobs } from "#/server/jobs/runner";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { env } from "#/test/auth";
import { truncateAll } from "#/test/db";

import { Route as DailyRoute } from "./daily";
import { Route as JobsRoute } from "./jobs";

// The real runner, with a spy so one test can make it throw
vi.mock("#/server/jobs/runner", async (original) => {
  const real = await original<typeof import("#/server/jobs/runner")>();
  return { ...real, runDueJobs: vi.fn(real.runDueJobs) };
});

// The two Vercel Cron routes (4.11, spec calls 1, 6 and 15): the 6-hourly retry run and the daily
// run. Each needs `Authorization: Bearer <CRON_SECRET>`; anything else gets 401.

const SECRET = "cron-secret-for-the-integration-tests-0123";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlersOf = (route: unknown) =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;

const routes = [
  ["jobs", handlersOf(JobsRoute)],
  ["daily", handlersOf(DailyRoute)],
] as const;

const call = (handlers: Record<string, Handler>, name: string, authorization?: string) =>
  handlers.GET!({
    request: new Request(`http://localhost:3000/api/cron/${name}`, {
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

describe.each(routes)("/api/cron/%s", (name, handlers) => {
  it("answers 401 with no Authorization header", async () => {
    expect((await call(handlers, name)).status).toBe(401);
  });

  it("answers 401 to the wrong secret", async () => {
    expect((await call(handlers, name, "Bearer wrong")).status).toBe(401);
    expect((await call(handlers, name, SECRET)).status).toBe(401);
    expect((await call(handlers, name, `Bearer ${SECRET}x`)).status).toBe(401);
  });

  it("answers a no-store 500 when CRON_SECRET isn't set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call(handlers, name, `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "not configured" });
  });

  it("a failing run answers a no-store 500 and logs no raw error", async () => {
    vi.mocked(runDueJobs).mockRejectedValueOnce(new Error("maya.patel@example.com failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call(handlers, name, `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "failed" });
    expect(logged).toHaveBeenCalledWith(`[cron] ${name}:`, { name: "Error" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("maya.patel");
  });

  it("is GET only", () => {
    expect(Object.keys(handlers)).toEqual(["GET"]);
  });
});

describe("/api/cron/daily", () => {
  it("queues and runs the four daily jobs", async () => {
    const response = await call(handlersOf(DailyRoute), "daily", `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ queued: 4, ran: 4, done: 4, failed: 0, dead: 0 });
    const rows = await getDb().select().from(jobs).orderBy(jobs.id);
    expect(rows.map((j) => [j.type, j.status])).toEqual(DAILY_JOBS.map((t) => [t, "done"]));
  });
});

describe("/api/cron/jobs", () => {
  it("runs a failed job whose retry time has come", async () => {
    await getDb()
      .insert(jobs)
      .values({
        type: "uploads.cleanup",
        payload: {},
        status: "failed",
        attempts: 1,
        idempotencyKey: "retry",
        runAfter: new Date(Date.now() - 60_000),
      });
    const response = await call(handlersOf(JobsRoute), "jobs", `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: 1, done: 1, failed: 0, dead: 0 });
    expect((await getDb().select().from(jobs))[0]).toMatchObject({ status: "done", attempts: 2 });
  });
});
