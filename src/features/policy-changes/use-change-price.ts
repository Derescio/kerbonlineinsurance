import { useEffect, useState } from "react";

import type { PriceChangeResult } from "#/server/policy-changes/writes";

import { priceMyPolicyChangeFn } from "./server";

// Prices a change as its dialog's form fills in (6.3b, decision 14): 300 ms after the last edit,
// once the form makes a whole change. An older answer that arrives late is dropped.

export type ChangePrice =
  | { state: "idle" }
  | { state: "pricing" }
  | { state: "done"; result: PriceChangeResult }
  | { state: "error"; message: string };

const DEBOUNCE_MS = 300;
export const PRICE_FAILED = "We couldn't price this change. Try again.";

export function useChangePrice(reference: string, change: unknown, retry = 0): ChangePrice {
  const [price, setPrice] = useState<ChangePrice>({ state: "idle" });
  const key = change === null || change === undefined ? null : JSON.stringify(change);

  useEffect(() => {
    if (key === null) {
      setPrice({ state: "idle" });
      return;
    }
    let current = true;
    setPrice({ state: "pricing" });
    const timer = setTimeout(() => {
      priceMyPolicyChangeFn({ data: { input: { reference, change: JSON.parse(key) } } })
        .then((answer) => {
          if (!current) return;
          setPrice(
            answer.ok
              ? { state: "done", result: answer.data }
              : { state: "error", message: answer.error.message },
          );
        })
        .catch(() => current && setPrice({ state: "error", message: PRICE_FAILED }));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [reference, key, retry]);

  return price;
}
