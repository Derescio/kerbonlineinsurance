import { useEffect, useRef } from "react";

// Cloudflare Turnstile on sign-up and reset (4.4, decision 3; plan/engineering.md section 9).
// The script loads only on the pages that show the widget. Real keys on Staging and Production,
// Cloudflare's always-pass test keys everywhere else. The server checks the token.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "light";
      size: "flexible";
      language: "en-GB";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load"));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export const turnstileSiteKey = import.meta.env.VITE_PUBLIC_TURNSTILE_SITE_KEY as
  | string
  | undefined;

export function Turnstile({
  onToken,
  resetKey,
}: {
  /** The token once the check passes; null when it expires or fails */
  onToken: (token: string | null) => void;
  /** Change it to get a fresh token: each one works once, so a failed submit needs a new one */
  resetKey?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    if (!turnstileSiteKey || !container.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        const id = api.render(container.current, {
          sitekey: turnstileSiteKey,
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
          theme: "light",
          size: "flexible",
          language: "en-GB",
        });
        widget.current = { api, id };
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey === undefined || !widget.current) return;
    widget.current.api.reset(widget.current.id);
    callback.current(null);
  }, [resetKey]);

  return <div ref={container} className="auth-turnstile" data-testid="turnstile" />;
}
