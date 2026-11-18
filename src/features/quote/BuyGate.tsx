import { skipToken, useQuery } from "@tanstack/react-query";
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

import { composeBundle } from "./bundle";
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
import type { HomeStep } from "./home-steps";
import { JourneyPage, StepNav } from "./page-kit";
import { priceQuery } from "./price-query";
import type { BuyableProductId } from "./products";
import { propertyTypeLabel } from "./schemas/home-steps";
import { saveBundleQuoteFn, saveHomeQuoteFn, saveQuoteFn } from "./server";
import { StepHeading } from "./step-kit";
import type { QuoteStep } from "./search";
import type { DriverStep } from "./steps";

// The gate, `step=buy` (5.6, decisions 2, 3, 11 and 13; screens 14 and 15, adapted to 5.4b's
// frame). A guest signs in or creates an account here, with 4.4's own forms, and the quote stays in
// the tab meanwhile. A signed-in visitor never sees the gate: the step saves the quote (once per
// answers, decision 5) and goes on to pay, or to Your saved quotes after Save and exit or a referred
// quote's "Sign in to send this for review". In a live bundle (5.7b) the home gate saves the car
// and the home as one quote.

/** The car waiting in a live bundle, and where a car answer the save refuses goes (5.7b) */
export interface GateBundle {
  car: Journey;
  /** The car step itself is no `step` at all */
  onCar: (step: QuoteStep | undefined) => void;
}

/** One policyholder per bundle (5.7b, decision 6) */
export const BUNDLE_MISMATCH = "Your name and date of birth must match your car quote.";

/** Where the gate goes once the quote is saved */
export type GateAfter = "pay" | "retrieve";

type SaveStep = "car" | DriverStep | HomeStep | "cover";

const productName = (product: BuyableProductId) => (product === "home" ? "Home" : "Car");

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
  product,
  journey,
  after,
  bundle,
  onBack,
  onNotQuoted,
  ...moves
}: {
  product: BuyableProductId;
  journey: Journey;
  after: GateAfter;
  bundle?: GateBundle;
  onBack: () => void;
  onInvalid: (step: SaveStep) => void;
} & Omit<CoverMoves, "onInvalid">) {
  const { query, result } = useCoverPrice(product, journey, {
    ...moves,
    onNotQuoted: (status) => {
      if (status === "referred" && after === "retrieve") return;
      onNotQuoted(status);
    },
  });
  const referredOk = result?.status === "referred" && after === "retrieve";

  if (result?.status !== "quoted" && !referredOk) {
    return (
      <JourneyPage
        heading={<GateHeading product={product} title={waitTitle(product)} />}
        aside={null}
      >
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
      product={product}
      journey={journey}
      prices={result?.status === "quoted" ? result : null}
      after={after}
      bundle={bundle}
      onBack={onBack}
      onInvalid={moves.onInvalid}
      onNotQuoted={onNotQuoted}
    />
  );
}

/** The heading while the gate isn't showing: the price or the session is on its way, or saving */
const waitTitle = (product: BuyableProductId) => `Your ${product} insurance`;

function GateHeading({
  product,
  mode = "login",
  title,
}: {
  product: BuyableProductId;
  mode?: "login" | "signup";
  title?: string;
}) {
  return (
    <StepHeading
      overline={`${productName(product)} insurance / Buy`}
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
  product,
  journey,
  prices,
  after,
  bundle,
  onBack,
  onInvalid,
  onNotQuoted,
}: {
  product: BuyableProductId;
  journey: Journey;
  /** The quoted price; null for a referred quote, which has none */
  prices: CoverPrices | null;
  after: GateAfter;
  bundle?: GateBundle;
  /** "Back to choose cover", or to Your quote on the way to Your saved quotes */
  onBack: () => void;
  /** Where the server sends a step that no longer passes */
  onInvalid: (step: SaveStep) => void;
  /** A bundle's home that can't be bought after all: Your quote shows 03 or 04 (5.7b) */
  onNotQuoted?: (status: "referred" | "declined") => void;
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
  const [mismatch, setMismatch] = useState(false);
  // The server says there's no session after all (one that still owes a code): show the gate
  const [signedOut, setSignedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<number | null>(null);
  const handlers = useRef({ onInvalid, onNotQuoted, rotate, idempotencyKey });
  useEffect(() => {
    handlers.current = { onInvalid, onNotQuoted, rotate, idempotencyKey };
  });
  // Whether the gate is still showing when a save comes back: after Back it isn't, and the save
  // mustn't move the visitor on. A mount flag, not the save effect's own cleanup: StrictMode's
  // rehearsal unmount runs that cleanup, and the remount's run returns early (started), so a
  // per-run flag would drop the real save's navigation.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const signedIn = Boolean(session.data) && !signedOut;

  useEffect(() => {
    if (!signedIn || started.current === attempt) return;
    started.current = attempt;
    // A bundle's save is keyed on both journeys: the mark doesn't change the home's own key
    const key = bundle
      ? `${savedQuoteKey(bundle.car)}:${savedQuoteKey(journey)}`
      : savedQuoteKey(journey);
    const go = (quoteId: string) =>
      void navigate(
        // Back from pay returns to the step before the gate, not to a gate that sends it on again
        after === "retrieve"
          ? { to: "/quote/retrieve", replace: true }
          : { to: "/quote/pay/$quoteId", params: { quoteId }, replace: true },
      );

    // One save per answers (decision 5): Back then Buy with nothing changed reuses it
    if (journey.saved && journey.saved.key === key) {
      go(journey.saved.quoteId);
      return;
    }
    const { onInvalid: invalid, onNotQuoted: notQuoted, rotate: newKey } = handlers.current;
    const fail = (thrown: unknown) => {
      const outcome = writeOutcome(thrown);
      if (outcome.kind === "sign_in") {
        if (mounted.current) setSignedOut(true);
        return;
      }
      if (outcome.rotateKey) newKey();
      if (mounted.current) setFailure(outcome.message);
    };
    if (bundle) {
      saveBundleQuoteFn({
        data: {
          input: { car: journeyToSave(bundle.car), home: journeyToSave(journey) },
          idempotencyKey: handlers.current.idempotencyKey,
        },
      })
        .then((result) => {
          if (!result.ok) {
            if (mounted.current) setFailure(result.error.message);
            return;
          }
          newKey();
          const data = result.data;
          if (data.status === "saved") {
            setSaved("home", { quoteId: data.quoteId, key });
            if (mounted.current) go(data.quoteId);
            return;
          }
          if (!mounted.current) return;
          if (data.status === "mismatch") setMismatch(true);
          else if (data.status === "invalid" && data.product === "car") {
            bundle.onCar(data.step === "car" ? undefined : data.step);
          } else if (data.status === "invalid") invalid(data.step);
          else if (data.product === "car") bundle.onCar("quote");
          else if (notQuoted) notQuoted(data.outcome);
          else setFailure(somethingWrong());
        })
        .catch(fail);
      return;
    }
    const saveFn = product === "home" ? saveHomeQuoteFn : saveQuoteFn;
    saveFn({
      data: {
        input: { journey: journeyToSave(journey) },
        idempotencyKey: handlers.current.idempotencyKey,
      },
    })
      .then((result) => {
        if (!result.ok) {
          if (mounted.current) setFailure(result.error.message);
          return;
        }
        // The key's write is done: the next save is a new one
        newKey();
        const data = result.data;
        if (data.status === "saved") {
          // Kept even after Back: the quote exists, so Buy again reuses it (decision 5)
          setSaved(product, { quoteId: data.quoteId, key });
          if (mounted.current) go(data.quoteId);
          return;
        }
        // Gone after Back: the next Buy saves again and gets the same answer then
        if (!mounted.current) return;
        if (data.status === "invalid") {
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
          if (mounted.current) setSignedOut(true);
          return;
        }
        if (outcome.rotateKey) newKey();
        if (mounted.current) setFailure(outcome.message);
      });
  }, [signedIn, attempt, journey, after, navigate, product, bundle]);

  if (session.isPending) {
    return (
      <JourneyPage
        heading={<GateHeading product={product} title={waitTitle(product)} />}
        aside={null}
      >
        <span />
      </JourneyPage>
    );
  }

  if (signedIn) {
    return (
      <JourneyPage
        heading={
          <GateHeading
            product={product}
            title={failure ? "We couldn’t save your quote" : waitTitle(product)}
          />
        }
        aside={
          <CoverWaiting product={product} journey={journey} prices={prices} car={bundle?.car} />
        }
      >
        {mismatch ? (
          <Alert tone="warning" announce>
            <p>{BUNDLE_MISMATCH}</p>
            <Button variant="secondary" size="sm" onClick={() => onInvalid("about")}>
              Check your details
            </Button>
          </Alert>
        ) : failure ? (
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
      heading={<GateHeading product={product} mode={mode} />}
      aside={<CoverWaiting product={product} journey={journey} prices={prices} car={bundle?.car} />}
    >
      <Card padding="lg" className="quote-gate">
        {mode === "signup" ? (
          <SignUpForm
            key="signup"
            title="New to Kerb?"
            extraLine="We only use these details to run your account. Confirm your email after signing up, then return to payment."
            quote={
              bundle
                ? {
                    product: "bundle",
                    car: journeyToSave(bundle.car),
                    home: journeyToSave(journey),
                  }
                : { product, journey: journeyToSave(journey) }
            }
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
            to={product === "home" ? "/quote/home" : "/quote/car"}
            search={(current: Record<string, unknown>) => ({
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
function CoverWaiting({
  product,
  journey,
  prices,
  car: bundledCar,
}: {
  product: BuyableProductId;
  journey: Journey;
  prices: CoverPrices | null;
  /** The car in a bundle (5.7b): named under the home */
  car?: Journey;
}) {
  const car = journey.vehicle;
  const property = journey.property;
  const chosen = prices ? usableCover(prices, journey.cover ?? DEFAULT_COVER) : null;
  const composed = prices && chosen ? composeCover(prices, chosen.coverLevel, chosen.addons) : null;
  // In a bundle, both together at the bundle's price, as screen 22 showed it (5.7b)
  const { data: carPrices } = useQuery(
    bundledCar
      ? priceQuery("car", bundledCar)
      : { queryKey: ["quote-price", "car", "none"], queryFn: skipToken },
  );
  const carChosen =
    bundledCar && carPrices?.status === "quoted"
      ? usableCover(carPrices, bundledCar.cover ?? DEFAULT_COVER)
      : null;
  const together =
    prices && chosen && carChosen && carPrices?.status === "quoted"
      ? composeBundle({ prices: carPrices, cover: carChosen }, { prices, cover: chosen })
      : null;
  return (
    <Card padding="lg" as="section" className="quote-waiting" aria-labelledby="waiting-heading">
      <h2 id="waiting-heading" className="kb-h4">
        Your cover is waiting
      </h2>
      <p className="quote-outcome__name">
        {product === "home"
          ? property?.address
            ? `${property.address.line1}, ${property.address.town}`
            : "Your home"
          : car
            ? `${car.make} ${car.model} ${car.variant}`
            : "Your car"}
      </p>
      <p className="quote-outcome__meta">
        {[
          product === "home"
            ? property && propertyTypeLabel(property.propertyType)
            : car?.demoPlate,
          chosen && `${TIERS[chosen.coverLevel].name} cover`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {bundledCar?.vehicle ? (
        <p className="quote-outcome__name">
          And your {bundledCar.vehicle.make} {bundledCar.vehicle.model} {bundledCar.vehicle.variant}
          {carChosen ? `, ${TIERS[carChosen.coverLevel].name} cover` : ""}
        </p>
      ) : null}
      {bundledCar ? (
        together ? (
          <p className="quote-waiting__amount">
            {journey.payment === "monthly"
              ? `Together: 12 payments of ${formatPounds(together.monthlyPaymentPence)}`
              : `Together: ${formatPounds(together.totalPence)} a year`}
          </p>
        ) : null
      ) : composed ? (
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
