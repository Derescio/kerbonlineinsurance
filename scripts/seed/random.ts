// The seed's randomness (4.9, call 10): mulberry32 from a fixed seed, so every run generates the same
// data. Each customer reads its own stream (`fork`), so adding customers never shifts another's.

/** The fixed seed */
export const SEED = 4_9_2026;

/** The 12 months of history: from 1 Nov 2025 to 4.8's valuation date */
export const SEED_FROM = new Date("2025-11-01T00:00:00Z");
export const SEED_TO = new Date("2026-10-31T23:59:59Z");

// FNV-1a, 32 bit
function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive at both ends */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from an empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) throw new Error("weighted pick with no weight");
    let r = this.next() * total;
    for (const [item, w] of items) {
      if (w <= 0) continue;
      if (r < w) return item;
      r -= w;
    }
    // Floating point: fall back to the last weighted item
    return [...items].reverse().find(([, w]) => w > 0)![0];
  }

  dateBetween(from: Date, to: Date): Date {
    return new Date(from.getTime() + Math.floor(this.next() * (to.getTime() - from.getTime() + 1)));
  }

  /** An independent stream named by `label`, from this generator's seed (not its position) */
  fork(label: string): Rng {
    return new Rng(Math.imul(this.seed ^ hashLabel(label), 0x9e3779b1) ^ hashLabel(`${label}#`));
  }
}

/** A uuidv7 (RFC 9562) for a backdated row: its timestamp, then random bits from `rng` */
export function uuidv7At(at: Date, rng: Rng): string {
  const bytes = new Uint8Array(16);
  let ms = at.getTime();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  for (let i = 6; i < 16; i++) bytes[i] = Math.floor(rng.next() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
