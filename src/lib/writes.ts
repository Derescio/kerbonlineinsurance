import { useState } from "react";

import { PublicError } from "#/server/auth/errors";

// The browser half of safe writes (4.5c). One key per form scope, kept in sessionStorage.
// Rotate the key after a success and after an IDEMPOTENCY_CONFLICT. Keep it after a network
// failure, so a retry replays the same write. It survives the sign-in redirect because that
// is the same tab. The key made during SSR differs from the client's, so never render it into
// markup; use it only in the submit handler.

const PREFIX = "kerb:idempotency:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(storageKey: string): string | null {
  try {
    const value = sessionStorage.getItem(storageKey);
    return value !== null && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

function write(storageKey: string, key: string): void {
  try {
    sessionStorage.setItem(storageKey, key);
  } catch {
    // Storage is blocked or absent (SSR). The key lives in memory only.
  }
}

function fresh(storageKey: string): string {
  const key = crypto.randomUUID();
  write(storageKey, key);
  return key;
}

export function useIdempotencyKey(scope: string): { key: string; rotate: () => void } {
  const storageKey = PREFIX + scope;
  const [state, setState] = useState(() => ({ scope, key: read(storageKey) ?? fresh(storageKey) }));
  let current = state;
  if (state.scope !== scope) {
    // A route component stays mounted when only its params change, so adjust during render
    // rather than in an effect, which would show the old scope's key for one commit.
    current = { scope, key: read(storageKey) ?? fresh(storageKey) };
    setState(current);
  }
  return { key: current.key, rotate: () => setState({ scope, key: fresh(storageKey) }) };
}

export type WriteOutcome =
  | { kind: "sign_in" }
  | { kind: "message"; message: string; rotateKey: boolean };

export function writeOutcome(error: unknown): WriteOutcome {
  if (error instanceof PublicError) {
    if (error.code === "UNAUTHENTICATED") return { kind: "sign_in" };
    return {
      kind: "message",
      message: error.message,
      rotateKey: error.code === "IDEMPOTENCY_CONFLICT",
    };
  }
  return { kind: "message", message: "Something went wrong. Please try again.", rotateKey: false };
}
