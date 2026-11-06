// The pure audit chain: what gets signed, how, and how the keys are read.
//
// This file imports nothing but node:crypto (spec call 15). The verify and make-admin scripts load
// it under plain Node, which resolves neither the `#/` alias nor zod, so anything more would
// break them.
//
// `changes` is stored as jsonb, and the hash is recomputed from what jsonb returns. Only strings
// without NUL or lone surrogates, booleans, null, safe integers, and arrays or plain objects of
// those come back unchanged. Floats lose precision, NaN and undefined don't survive, a Date
// becomes a string, and Postgres refuses \u0000. assertChainable refuses the rest before any SQL
// runs, so the row and the change it records roll back together.
import { createHmac } from "node:crypto";

export const AUDIT_FORMAT = 1;

// pg_advisory_xact_lock key shared by audit() and make-admin: 0x6b657262, "kerb"
export const AUDIT_LOCK_KEY = 1801810530;

export type AuditValue =
  | string
  | boolean
  | null
  | number
  | AuditValue[]
  | { [key: string]: AuditValue };

// The row as it is signed: everything except the id and the hash itself
export interface ChainRow {
  prevHash: string | null;
  keyVersion: string;
  createdAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, AuditValue> | null;
  reason: string | null;
  requestId: string | null;
  ipHash: string | null;
}

export class AuditValueError extends Error {
  override name = "AuditValueError";
  readonly field: string;
  constructor(field: string) {
    // Names the field only, never the value
    super(`Audit value for "${field}" can't be stored and verified unchanged`);
    this.field = field;
  }
}

type KeyErrorReason =
  | "missing"
  | "malformed"
  | "short_key"
  | "duplicate_version"
  | "unknown_active_version";

export class AuditKeyError extends Error {
  override name = "AuditKeyError";
  readonly reason: KeyErrorReason;
  constructor(reason: KeyErrorReason, detail: string) {
    // The detail is a version label or a setting name, never key material
    super(`Audit HMAC key configuration is invalid (${reason}): ${detail}`);
    this.reason = reason;
  }
}

export interface AuditKeys {
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}

// isWellFormed is ES2024 (Node 20+); the project's TypeScript lib doesn't list it yet
function goodString(s: string): boolean {
  return (s as string & { isWellFormed(): boolean }).isWellFormed() && !s.includes("\u0000");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function assertValue(v: unknown, path: string): void {
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "string") {
    if (!goodString(v)) throw new AuditValueError(path);
    return;
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new AuditValueError(path);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((item, i) => assertValue(item, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(v)) {
    for (const [k, item] of Object.entries(v)) {
      if (!goodString(k)) throw new AuditValueError(`${path}.<key>`);
      assertValue(item, `${path}.${k}`);
    }
    return;
  }
  // undefined, bigint, Date, functions, class instances
  throw new AuditValueError(path);
}

export function assertChainable(row: ChainRow): void {
  const text: [string, string | null][] = [
    ["prevHash", row.prevHash],
    ["keyVersion", row.keyVersion],
    ["actorUserId", row.actorUserId],
    ["actorRole", row.actorRole],
    ["action", row.action],
    ["entityType", row.entityType],
    ["entityId", row.entityId],
    ["reason", row.reason],
    ["requestId", row.requestId],
    ["ipHash", row.ipHash],
  ];
  for (const [field, value] of text) {
    if (value !== null && !goodString(value)) throw new AuditValueError(field);
  }
  if (row.changes !== null) assertValue(row.changes, "changes");
}

// Canonical JSON text with object keys in string order at every depth. Built as text because a
// JS object reorders integer-like keys ("2" before "10") whatever order they were inserted in.
function canonical(v: AuditValue): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const members = Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k] as AuditValue)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(v);
}

export function canonicalPayload(row: ChainRow): string {
  // The same text JSON.stringify([...]) gives, with the changes slot spliced in as canonical text
  const head = JSON.stringify([
    AUDIT_FORMAT,
    row.prevHash,
    row.keyVersion,
    row.createdAt.toISOString(),
    row.actorUserId,
    row.actorRole,
    row.action,
    row.entityType,
    row.entityId,
  ]).slice(0, -1);
  const tail = JSON.stringify([row.reason, row.requestId, row.ipHash]).slice(1);
  const changes = row.changes === null ? "null" : canonical(row.changes);
  return `${head},${changes},${tail}`;
}

export function computeHash(row: ChainRow, key: Buffer): string {
  return createHmac("sha256", key).update(canonicalPayload(row)).digest("hex");
}

// AUDIT_HMAC_KEYS is "v1:base64key[,v2:base64key…]". Errors name the version or the setting,
// never the key, because a pasted value must not end up in logs.
export function parseKeys(raw: string | undefined, activeVersion: string | undefined): AuditKeys {
  if (raw === undefined || raw.trim() === "") {
    throw new AuditKeyError("missing", "AUDIT_HMAC_KEYS");
  }
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    const colon = trimmed.indexOf(":");
    const version = colon === -1 ? "" : trimmed.slice(0, colon).trim();
    const b64 = colon === -1 ? "" : trimmed.slice(colon + 1).trim();
    if (!/^v[0-9]+$/.test(version) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      throw new AuditKeyError("malformed", "AUDIT_HMAC_KEYS entry");
    }
    if (keys.has(version)) throw new AuditKeyError("duplicate_version", version);
    const key = Buffer.from(b64, "base64");
    if (key.length < 32) throw new AuditKeyError("short_key", version);
    keys.set(version, key);
  }
  const active = activeVersion?.trim();
  if (!active) throw new AuditKeyError("missing", "AUDIT_HMAC_ACTIVE_VERSION");
  if (!keys.has(active)) throw new AuditKeyError("unknown_active_version", active);
  return { activeVersion: active, keys };
}

// Never earlier than the previous row, so a clock that runs behind another instance's, or two
// rows in the same millisecond, still leave created_at in chain order
export function nextCreatedAt(previous: Date | null, now: Date): Date {
  return previous !== null && previous.getTime() > now.getTime() ? previous : now;
}
