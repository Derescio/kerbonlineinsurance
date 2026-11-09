import { useEffect, useRef } from "react";

import { useToast, type ToastInput } from "#/components/feedback/Toaster";

/**
 * Shows a toast once for a ?query flag (?confirmed=true, ?reset=done), then calls `clear` so the
 * flag leaves the URL and a refresh or Back doesn't show it again. The ref holds across React's
 * development double-run of effects, which otherwise showed every toast twice.
 */
export function useOneTimeToast(input: ToastInput | null, clear: () => void) {
  const toast = useToast();
  const shown = useRef(false);
  const latest = useRef({ input, clear });
  latest.current = { input, clear };
  const pending = input !== null;

  useEffect(() => {
    const { input: current, clear: clearFlag } = latest.current;
    if (!pending || !current || shown.current) return;
    shown.current = true;
    toast(current);
    clearFlag();
  }, [pending, toast]);
}
