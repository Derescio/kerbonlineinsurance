import { useEffect, useState } from "react";

// Whether anyone is signed in, asked after the page loads (6.1, decision 8). The public pages are
// CDN-cached, so the server can't say; /api/session-hint is never cached. Any failure is "signed
// out", which only leaves the header saying "Log in".

export type SessionHint = "unknown" | "signed-in" | "signed-out";

export function useSessionHint(): SessionHint {
  const [hint, setHint] = useState<SessionHint>("unknown");
  useEffect(() => {
    let live = true;
    void fetch("/api/session-hint", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json() as Promise<{ signedIn?: unknown }>)
      .then((body) => body.signedIn === true)
      .catch(() => false)
      .then((signedIn) => {
        if (live) setHint(signedIn ? "signed-in" : "signed-out");
      });
    return () => {
      live = false;
    };
  }, []);
  return hint;
}
