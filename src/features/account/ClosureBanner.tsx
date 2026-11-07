import { useEffect, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { useIdempotencyKey, writeOutcome } from "#/lib/writes";

import { getClosureBanner, keepMyAccount, type ClosureBannerData } from "./closure";

// The closure banner (4.7): on every signed-in page while a closure is open. It's fetched in the
// browser after mount, never rendered on the server, because some site pages are served from a
// public CDN cache and the banner is per visitor (Review Focus 3).

const SOMETHING_WRONG = "Something went wrong. Please try again.";

/** "7 December", in UK time */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

export function closureSentence({ closesAt, held }: ClosureBannerData): string {
  return held
    ? "Your account will close once your claim is settled."
    : `Your account closes on ${formatDay(closesAt)}.`;
}

/** One click, no re-authentication. `kept` turns true once the closure is cancelled */
export function useKeepAccount() {
  const { key, rotate } = useIdempotencyKey("account.keep");
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string>();

  async function keep() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await keepMyAccount({ data: { input: {}, idempotencyKey: key } });
      if (result.ok) {
        rotate();
        setKept(true);
      } else {
        setError(result.error.message);
      }
    } catch (thrown) {
      const outcome = writeOutcome(thrown);
      if (outcome.kind === "message") {
        if (outcome.rotateKey) rotate();
        setError(outcome.message);
      } else {
        setError(SOMETHING_WRONG);
      }
    }
    setBusy(false);
  }

  return { keep, busy, kept, error };
}

export function ClosureBanner() {
  const [data, setData] = useState<ClosureBannerData | null>(null);
  const { keep, busy, kept, error } = useKeepAccount();

  useEffect(() => {
    let live = true;
    getClosureBanner()
      .then((next) => {
        if (live) setData(next);
      })
      .catch(() => {
        // No banner is better than a broken page
      });
    return () => {
      live = false;
    };
  }, []);

  if (kept) {
    return (
      <div className="site-container" style={{ paddingBlock: "var(--space-3)" }}>
        <Alert tone="success" announce>
          Your account will stay open.
        </Alert>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="site-container" style={{ paddingBlock: "var(--space-3)" }}>
      <Alert
        tone="warning"
        action={
          <Button variant="secondary" size="sm" loading={busy} onClick={keep}>
            Keep my account
          </Button>
        }
      >
        <span>{closureSentence(data)}</span>
        {error ? <span> {error}</span> : null}
      </Alert>
    </div>
  );
}
