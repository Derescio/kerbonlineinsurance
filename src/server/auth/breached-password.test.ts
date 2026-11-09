import { describe, expect, it, vi } from "vite-plus/test";

import { checkPassword } from "./breached-password";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function rangeResponse(lines: string[]) {
  return vi.fn(async () => new Response(lines.join("\r\n"), { status: 200 }));
}

describe("checkPassword (Have I Been Pwned range API)", () => {
  it("sends only the first five characters of the SHA-1 hash", async () => {
    const fetchFn = rangeResponse([]);
    await checkPassword("password", fetchFn);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(url).not.toContain(SUFFIX);
    expect(new Headers(init.headers).get("Add-Padding")).toBe("true");
  });

  it("reports a breached password", async () => {
    expect(await checkPassword("password", rangeResponse([`${SUFFIX}:9659365`]))).toBe("breached");
  });

  it("ignores padding rows with a count of 0", async () => {
    expect(await checkPassword("password", rangeResponse([`${SUFFIX}:0`]))).toBe("clean");
  });

  it("passes a password that isn't in the list", async () => {
    expect(
      await checkPassword("password", rangeResponse(["0000000000000000000000000000000000A:3"])),
    ).toBe("clean");
  });

  it("fails open when the service is down or slow, so sign-up still works", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await checkPassword("password", down)).toBe("unavailable");
    const throws = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkPassword("password", throws)).toBe("unavailable");
  });
});
