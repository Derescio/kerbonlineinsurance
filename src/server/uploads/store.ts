import { getR2Env } from "#/server/env";

import { R2ObjectStore } from "./store-r2";

// Where uploaded files live (4.10, call 13). The app talks to this interface only: R2 in every
// deployed environment, an in-memory fake in the integration tests, so `ci` never needs R2
// credentials.

export interface ObjectStore {
  /** A link the browser PUTs one object to, with its type and exact length signed in */
  presignPut(key: string, opts: { contentType: string; contentLength: number }): Promise<string>;
  /** A short-lived link to read one object */
  presignGet(key: string): Promise<string>;
  /** null when there is no such object */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  readFirstBytes(key: string, count: number): Promise<Uint8Array>;
  /** Deleting a missing object is fine */
  delete(key: string): Promise<void>;
  /** A small object written by the server itself, e.g. the daily audit anchor (4.11) */
  putObject(key: string, body: string, contentType: string): Promise<void>;
  /** A whole object as text; null when there is no such object */
  getText(key: string): Promise<string | null>;
  /** Every key under a prefix */
  list(prefix: string): Promise<string[]>;
}

let override: ObjectStore | null = null;
let r2: ObjectStore | null = null;

/** The test's store if one is set, else R2 built from the environment on first use */
export function getObjectStore(): ObjectStore {
  if (override) return override;
  r2 ??= new R2ObjectStore(getR2Env());
  return r2;
}

/** For tests: use this store until it's set back to null */
export function setObjectStore(store: ObjectStore | null): void {
  override = store;
}
