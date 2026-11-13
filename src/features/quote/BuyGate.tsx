import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { Alert } from "#/components/feedback/Alert";
import { LoginForm } from "#/features/auth/LoginForm";
import { getSessionUser } from "#/features/auth/session";
import { SignUpForm } from "#/features/auth/SignUpForm";
import { formatPounds } from "#/features/rating/money";
import { useIdempotencyKey, writeOutcome } from "#/lib/writes";

import { useCoverPrice, type CoverMoves } from "./ChooseCover";
import { composeCover, TIERS, usableCover, type CoverPrices } from "./cover";
import {
  DEFAULT_COVER,
  journeyToSave,
  noteCarWithdrawn,
  savedQuoteKey,
  setSaved,
  setVehicle,
  type Journey,
} from "./journey-store";
import { JourneyPage, StepNav } from "./page-kit";
import { saveQuoteFn } from "./server";
import { StepHeading } from "./step-kit";
import type { DriverStep } from "./steps";

// The gate, `step=buy` (5.6, decisions 2, 3, 11 and 13; screens 14 and 15, adapted to 5.4b's
// frame). A guest signs in or creates an account here, with 4.4's own forms, and the quote stays in
// the tab meanwhile. A signed-in visitor never sees the gate: the step saves the quote (once per
// answers, decision 5) and goes on to pay, or to Your saved quotes after Save and exit or a referred
// quote's "Sign in to send this for review".

/** Where the gate goes once the quote is saved */
export type GateAfter = "pay" | "retrieve";

type SaveStep = "car" | DriverStep | "cover";

/** writeOutcome's line for anything it doesn't know */
const somethingWrong = () => {
  const outcome = writeOutcome(undefined);
  return outcome.kind === "message" ? outcome.message : "";
};

const whole = (pence: number) => formatPounds(pence).replace(".00", "");

/**
 * The step: only a quoted journey reaches the gate, as Choose cover (decision 2). A referred quote
 * is let through when it's on its way to Your saved quotes (decision 11), with no price to show.
 */
export function BuyStep({
  journey,
  after,
  onBack,
  onNotQuoted,
  ...moves
}: {
  journey: Journey;
  after: GateAfter;
  onBack: () => void;
  onInvalid: (step: SaveStep) => void;
} & Omit<CoverMoves, "onInvalid">) {
  const { query, result } = useCoverPrice(journey, {
    ...moves,
    onNotQuoted: (status) => {
      if (status === "referred" && after === "retrieve") return;
      onNotQuoted(status);
    },
  });
  const referredOk = result?.status === "referred" && after === "retrieve";

  if (result?.status !== "quoted" && !referredOk) {
    return (
      <JourneyPage heading={<GateHeading title={WAIT_TITLE} />} aside={null}>
        {query.isError && !result ? (
          <Alert tone="warning" announce>
            <p>We couldn&rsquo;t work out your price just now.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Alert>
        ) : (
          <Card padding="lg" className="quote-slot">
            <p role="status">Working out your price&hellip;</p>
          </Card>
        )}
        <StepNav onBack={onBack} backLabel={backLabel(after)} />
      </JourneyPage>
    );
  }
  return (
    <BuyGate
      journey={journey}
      prices={result?.status === "quoted" ? result : null}
      after={after}
      onBack={onBack}
      onInvalid={moves.onInvalid}
    />
  );
}

/** The heading while the gate isn't showing: the price or the session is on its way, or saving */
const WAIT_TITLE = "Your car insurance";

function GateHeading({ mode = "login", title }: { mode?: "login" | "signup"; title?: string }) {
  return (
    <StepHeading
      overline="Car insurance / Buy"
      title={
        title ?? (mode === "signup" ? "Create your account to continue" : "Sign in before you pay")
      }
      intro={
        title
          ? undefined
          : `We’ll save your quote and selected cover when you ${
              mode === "signup" ? "create your account" : "sign in"
            }. You’ll review your payment details next.`
      }
    />
  );
}

export function BuyGate({
  journey,
  prices,
  after,
  onBack,
  onInvalid,
}: {
  journey: Journey;
  /** The quoted price; null for a referred quote, which has none */
  prices: CoverPrices | null;
  after: GateAfter;
  /** "Back to choose cover", or to Your quote on the way to Your saved quotes */
  onBack: () => void;
  /** Where the server sends a step that no longer passes */
  onInvalid: (step: SaveStep) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const mode = (location.search as { auth?: string }).auth === "signup" ? "signup" : "login";
  const session = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUser(),
    staleTime: 0,
    retry: false,
  });
  const { key: idempotencyKey, rotate } = useIdempotencyKey("quote.save");
  const [failure, setFailure] = useState<string | null>(null);
  // The server says there's no session after all (one that still owes a code): show the gate
  const [signedOut, setSignedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<number | null>(null);
  const handlers = useRef({ onInvalid, rotate, idempotencyKey });
  useEffect(() => {
    handlers.current = { onInvalid, rotate, idempotencyKey };
  });

  const signedIn = Boolean(session.data) && !signedOut;

  useEffect(() => {
    if (!signedIn || started.current === attempt) return;
    started.current = attempt;
    const key = savedQuoteKey(journey);
    const go = (quoteId: string) =>
      void navigate({
        href: after === "retrieve" ? "/quote/retrieve" : `/quote/pay/${quoteId}`,
        // Back from pay returns to the step before the gate, not to a gate that sends it on again
        replace: true,
      });

    // One save per answers (decision 5): Back then Buy with nothing changed reuses it
    if (journey.saved && journey.saved.key === key) {
      go(journey.saved.quoteId);
      return;
    }
    const { onInvalid: invalid, rotate: newKey } = handlers.current;
    saveQuoteFn({
      data: {
        input: { journey: journeyToSave(journey) },
        idempotencyKey: handlers.current.idempotencyKey,
      },
    })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error.message);
          return;
        }
        // The key's write is done: the next save is a new one
        newKey();
        const data = result.data;
        if (data.status === "saved") {
          setSaved({ quoteId: data.quoteId, key });
          go(data.quoteId);
        } else if (data.status === "invalid") {
          if (data.step === "car") {
            setVehicle(null);
            noteCarWithdrawn();
          }
          invalid(data.step);
        } else {
          // Declined can't reach here: the step needs a quoted journey (or a referred one)
          setFailure(somethingWrong());
        }
      })
      .catch((thrown: unknown) => {
        const outcome = writeOutcome(thrown);
        if (outcome.kind === "sign_in") {
          setSignedOut(true);
          return;
        }
        if (outcome.rotateKey) newKey();
        setFailure(outcome.message);
      });
  }, [signedIn, attempt, journey, after, navigate]);

  if (session.isPending) {
    return (
      <JourneyPage heading={<GateHeading title={WAIT_TITLE} />} aside={null}>
        <span />
      </JourneyPage>
    );
  }

  if (signedIn) {
    return (
      <JourneyPage
        heading={<GateHeading title={failure ? "We couldn’t save your quote" : WAIT_TITLE} />}
        aside={<CoverWaiting journey={journey} prices={prices} />}
      >
        {failure ? (
          <Alert tone="warning" announce>
            <p>{failure}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailure(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </Alert>
        ) : (
          <Card padding="lg" className="quote-slot">
            <p role="status">Saving your quote&hellip;</p>
          </Card>
        )}
        <StepNav onBack={onBack} backLabel={backLabel(after)} />
      </JourneyPage>
    );
  }

  // Back to this step once signed in, on the sign-in half
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(location.search as Record<string, unknown>)) {
    if (name !== "auth" && (typeof value === "string" || typeof value === "number")) {
      params.set(name, String(value));
    }
  }
  const here = `${location.pathname}?${params}`;

  return (
    <JourneyPage
      heading={<GateHeading mode={mode} />}
      aside={<CoverWaiting journey={journey} prices={prices} />}
    >
      <Card padding="lg" className="quote-gate">
        {mode === "signup" ? (
          <SignUpForm
            key="signup"
            title="New to Kerb?"
            extraLine="We only use these details to run your account. Confirm your email after signing up, then return to payment."
            quote={{ journey: journeyToSave(journey) }}
            redirectTo={here}
          />
        ) : (
          <LoginForm
            key="login"
            title="Welcome back"
            submitLabel="Sign in and continue to payment"
            redirectTo={here}
            newUserRedirectTo={here}
            onSignedIn={() => {
              setSignedOut(false);
              void session.refetch();
            }}
          />
        )}
        <p className="quote-gate__switch">
          {mode === "signup" ? "Already have an account? " : "New to Kerb? "}
          <Link
            from="/quote/car"
            to="/quote/car"
            search={(current) => ({
              ...current,
              auth: mode === "signup" ? undefined : ("signup" as const),
            })}
            className="quote-link"
          >
            {mode === "signup" ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </Card>
      <StepNav onBack={onBack} backLabel={backLabel(after)} />
    </JourneyPage>
  );
}

function backLabel(after: GateAfter) {
  return after === "retrieve" ? "Back to your quote" : "Back to choose cover";
}

/** "Your cover is waiting" (decision 3): no "Quote saved" badge and no "Cover starts" (decision 8) */
function CoverWaiting({ journey, prices }: { journey: Journey; prices: CoverPrices | null }) {
  const car = journey.vehicle;
  const chosen = prices ? usableCover(prices, journey.cover ?? DEFAULT_COVER) : null;
  const composed = prices && chosen ? composeCover(prices, chosen.coverLevel, chosen.addons) : null;
  return (
    <Card padding="lg" as="section" className="quote-waiting" aria-labelledby="waiting-heading">
      <h2 id="waiting-heading" className="kb-h4">
        Your cover is waiting
      </h2>
      <p className="quote-outcome__name">
        {car ? `${car.make} ${car.model} ${car.variant}` : "Your car"}
      </p>
      <p className="quote-outcome__meta">
        {[car?.demoPlate, chosen && `${TIERS[chosen.coverLevel].name} cover`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {composed ? (
        <>
          <p className="quote-waiting__amount">
            {journey.payment === "monthly"
              ? `12 payments of ${formatPounds(composed.monthlyPaymentPence)}`
              : `${formatPounds(composed.totalPence)} a year`}
          </p>
          <p className="quote-outcome__meta">
            Total excess {whole(composed.compulsoryExcessPence + composed.voluntaryExcessPence)}
          </p>
        </>
      ) : null}
      <p className="quote-waiting__note">
        No payment is taken when you sign in or create an account.
      </p>
    </Card>
  );
}
