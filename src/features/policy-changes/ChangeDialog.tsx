import { lazy, Suspense, useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Dialog } from "#/components/feedback/Dialog";
import type { PriceChangeResult } from "#/server/policy-changes/writes";

import { APPLIES_FROM_TODAY } from "./copy";
import { abandonMyPolicyChangeFn, confirmMyPolicyChangeFn } from "./server";
import { PRICE_FAILED, useChangePrice } from "./use-change-price";

// The frame of every "Make a change" dialog (Figma 183:3955, 183:4072, 183:4168): the fields, the
// price line once the form is whole, then Back and Confirm. A dearer annual change shows Stripe's
// embedded Checkout for the top-up in the dialog; the change applies when it's paid.

const StripeCheckout = lazy(() =>
  import("#/features/quote/StripeCheckout").then((m) => ({ default: m.StripeCheckout })),
);

export type Priced = Extract<PriceChangeResult, { status: "priced" }>;

export function ChangeDialog({
  open,
  onClose,
  title,
  reference,
  change,
  confirmLabel = "Confirm change",
  danger = false,
  onApplied,
  children,
  fields,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  reference: string;
  /** The whole change, or null while the form is incomplete */
  change: unknown;
  confirmLabel?: string;
  danger?: boolean;
  onApplied: () => void;
  children?: ReactNode;
  /** Fields that need the latest price (Change cover's levels and add-ons) */
  fields?: (priced: Priced | null) => ReactNode;
}) {
  const [retry, setRetry] = useState(0);
  const price = useChangePrice(reference, open ? change : null, retry);
  const [confirming, setConfirming] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const priced = price.state === "done" && price.result.status === "priced" ? price.result : null;

  function close() {
    // A top-up that's open can't be paid once the dialog's gone
    if (clientSecret && priced) {
      void abandonMyPolicyChangeFn({ data: { input: { changeId: priced.changeId } } });
    }
    setClientSecret(null);
    setRefusal(null);
    onClose();
  }

  async function confirm() {
    if (!priced) return;
    setConfirming(true);
    setRefusal(null);
    try {
      const answer = await confirmMyPolicyChangeFn({
        data: { input: { changeId: priced.changeId }, idempotencyKey: crypto.randomUUID() },
      });
      if (!answer.ok) {
        setRefusal(answer.error.message);
      } else if (answer.data.status === "applied") {
        onApplied();
      } else if (answer.data.status === "pay") {
        setClientSecret(answer.data.clientSecret);
      } else {
        setRefusal(
          answer.data.priceLine
            ? `${answer.data.message}. ${answer.data.priceLine}.`
            : answer.data.message,
        );
        // A new price for the same change, so Confirm sends the new one
        setRetry((n) => n + 1);
      }
    } catch {
      setRefusal(PRICE_FAILED);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      actions={
        clientSecret ? null : (
          <>
            <Button variant="ghost" onClick={close}>
              Back
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={!priced}
              loading={confirming}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div className="pc-dialog">
        {clientSecret ? (
          <Suspense fallback={<p className="pc-note">Loading the payment form…</p>}>
            <StripeCheckout clientSecret={clientSecret} />
          </Suspense>
        ) : (
          <>
            {children}
            {fields?.(priced)}
            <PriceArea price={price} />
            {refusal ? (
              <Alert tone="warning" announce>
                <p>{refusal}</p>
              </Alert>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

function PriceArea({ price }: { price: ReturnType<typeof useChangePrice> }) {
  if (price.state === "pricing") return <p className="pc-note">Working out your price…</p>;
  if (price.state === "error") {
    return (
      <Alert tone="danger" announce>
        <p>{price.message}</p>
      </Alert>
    );
  }
  if (price.state !== "done") return null;
  const { result } = price;
  if (result.status === "refused") {
    return (
      <Alert tone="warning" announce>
        <p>{result.message}</p>
      </Alert>
    );
  }
  return (
    <>
      <Alert
        tone={result.settlement === "refund" || result.amountPence < 0 ? "success" : "info"}
        title={result.priceLine}
        announce
      >
        <p>{APPLIES_FROM_TODAY}</p>
      </Alert>
      {result.homeWarning ? (
        <Alert tone="warning">
          <p>{result.homeWarning}</p>
        </Alert>
      ) : null}
    </>
  );
}
