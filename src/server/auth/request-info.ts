// What security_events records about a request: a keyed hash of the IP and a short browser
// summary, never the address or the raw user agent (plan/engineering.md section 9).

/** The client's IP. Vercel sets x-vercel-forwarded-for itself, so a client can't spoof it. */
export function clientIp(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

/**
 * HMAC-SHA256 of the IP, hex. Keyed so it can't be reversed with a table of every IPv4 address,
 * and stable so "Recent activity" can tell one place from another.
 */
export async function hashIp(ip: string | null, secret: string): Promise<string | null> {
  if (!ip) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`ip:${ip}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/** "Chrome on Windows", for "Recent activity" (6.3). Unknown agents are never echoed back. */
export function summariseUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser) return "Unknown browser";
  return system ? `${browser} on ${system}` : browser;
}
