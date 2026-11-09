import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { IdempotencyConflictError, PublicError, RateLimitError } from "./errors";
import { actorMiddleware, publicMiddleware, userMiddleware } from "./middleware";

vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => new Headers() }));
vi.mock("./actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actor")>()),
  getActor: vi.fn(async () => null),
}));

type Server = (args: { next: unknown; context: object }) => Promise<unknown>;
const run = (middleware: unknown, next: unknown) =>
  (middleware as { options: { server: Server } }).options.server({ next, context: {} });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("userMiddleware", () => {
  it("refuses a signed-out call with a PublicError before the handler runs", async () => {
    const next = vi.fn();
    const error = await run(userMiddleware, next).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicError);
    expect([(error as PublicError).code, (error as PublicError).status]).toEqual([
      "UNAUTHENTICATED",
      401,
    ]);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("actorMiddleware", () => {
  it("passes a null actor when signed out", async () => {
    const next = vi.fn(async () => "ok");
    await run(actorMiddleware, next);
    expect(next).toHaveBeenCalledWith({ context: { actor: null } });
  });

  it("turns a RateLimitError into RATE_LIMITED without logging it", async () => {
    const error = await run(actorMiddleware, async () => {
      throw new RateLimitError("quote.price");
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicError);
    expect([(error as PublicError).code, (error as PublicError).status]).toEqual([
      "RATE_LIMITED",
      429,
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("turns an IdempotencyConflictError into IDEMPOTENCY_CONFLICT without logging it", async () => {
    const error = await run(actorMiddleware, async () => {
      throw new IdempotencyConflictError();
    }).catch((e: unknown) => e);
    expect((error as PublicError).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("hides any other error as INTERNAL and logs only its name", async () => {
    const error = await run(actorMiddleware, async () => {
      throw new Error("db detail");
    }).catch((e: unknown) => e);
    expect((error as PublicError).code).toBe("INTERNAL");
    expect(errorSpy).toHaveBeenCalledWith("[server fn]", { name: "Error" });
  });
});

describe("publicMiddleware", () => {
  it("runs the handler without reading the session", async () => {
    const { getActor } = await import("./actor");
    vi.mocked(getActor).mockClear();
    const next = vi.fn(async () => "ok");
    await expect(run(publicMiddleware, next)).resolves.toBe("ok");
    expect(next).toHaveBeenCalledWith();
    expect(getActor).not.toHaveBeenCalled();
  });

  it("turns a RateLimitError into RATE_LIMITED", async () => {
    const error = await run(publicMiddleware, async () => {
      throw new RateLimitError("quote.started");
    }).catch((e: unknown) => e);
    expect((error as PublicError).code).toBe("RATE_LIMITED");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
