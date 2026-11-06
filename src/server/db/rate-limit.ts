// Postgres sliding-window rate limiter (plan/phases/04-data-auth/05c-safe-write-tools.md).
//
// - Fails closed: if the statement errors, the error propagates and the write doesn't happen.
// - A refused attempt still counts, so hammering a limit doesn't buy a way out of it.
// - limit() runs outside the write's transaction, so a rolled-back write can't refund the count.
// - Every time comparison uses the database clock (now()), never the app server's.
import { isIPv4, isIPv6 } from "node:net";

import { sql } from "drizzle-orm";

import type { Actor } from "#/server/auth/actor";
import { RateLimitError } from "#/server/auth/errors";
import { clientIp, hashIp } from "#/server/auth/request-info";
import { getAuthEnv } from "#/server/env";

import { getDb } from "./client";

export interface RateRule {
  max: number;
  windowSeconds: number;
}

/** Previous window's count, weighted by how much of it still lies inside the sliding window. */
export function slidingEstimate(
  previous: number,
  current: number,
  elapsedSeconds: number,
  windowSeconds: number,
): number {
  return previous * Math.max(0, 1 - elapsedSeconds / windowSeconds) + current;
}

export async function limit(key: string, rule: RateRule): Promise<void> {
  const w = rule.windowSeconds;
  const result = await getDb().execute(sql`
    with cur as (
      insert into rate_limits (key, window_start, count)
      values (${key}, date_bin(make_interval(secs => ${w}::double precision), now(), 'epoch'::timestamptz), 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count, window_start
    )
    select cur.count as current,
      coalesce((select r.count from rate_limits r
                where r.key = ${key} and r.window_start = cur.window_start - make_interval(secs => ${w}::double precision)), 0) as previous,
      extract(epoch from now() - cur.window_start)::float8 as elapsed
    from cur
  `);
  const row = result.rows[0] as { current: number; previous: number; elapsed: number } | undefined;
  if (!row) throw new Error("rate limit statement returned no row");
  const estimate = slidingEstimate(
    Number(row.previous),
    Number(row.current),
    Number(row.elapsed),
    w,
  );
  if (estimate > rule.max) {
    const action = key.split(":")[0] ?? key;
    console.warn("[rate-limit]", action);
    throw new RateLimitError(action);
  }
}

/** Expands any valid IPv6 text to its eight 16-bit groups. */
function expandIpv6(address: string): number[] {
  let text = address.split("%")[0] ?? address;
  // A dotted IPv4 tail stands for the last two groups
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = (dotted[2] ?? "").split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - front.length - back.length;
  return [...front, ...Array<string>(fill).fill("0"), ...back].map((g) => parseInt(g, 16));
}

/** IPv4 as is; IPv4-mapped IPv6 unwrapped; other IPv6 reduced to its /64 (one subscriber's block). */
export function rateLimitIp(ip: string): string {
  if (isIPv4(ip)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(ip)) return ip;
  return `${expandIpv6(ip)
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** Who a limit counts against: the signed-in user, else a keyed hash of the IP (never the IP). */
export async function rateLimitSubject(
  actor: Actor | null,
  headers: Headers,
  secret: string = getAuthEnv().BETTER_AUTH_SECRET,
): Promise<string> {
  if (actor) return `user:${actor.userId}`;
  const ip = clientIp(headers);
  if (!ip) return "ip:unknown";
  return `ip:${await hashIp(rateLimitIp(ip), secret)}`;
}
