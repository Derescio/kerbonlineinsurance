import { Link, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { useToast } from "#/components/feedback/Toaster";
import type { OpenDialog } from "#/features/policy-changes/ChangeDialogs";
import { POLICY_UPDATED, REFUNDED_AFTER_CHANGE } from "#/features/policy-changes/copy";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { Tooltip } from "#/components/feedback/Tooltip";
import { tierName } from "#/features/quote/labels";
import { propertyTypeLabel } from "#/features/quote/schemas/home-steps";
import { formatPounds } from "#/features/rating/money";
import type { PolicyDetail } from "#/server/data/policies";

import { DocumentList } from "./DocumentList";
import { documentFilename, documentHref, policyDocuments } from "./documents";
import { dayAfter, longDay, rowStatus } from "./overview-model";
import { driverLine, excessParts, fullName, insuredName, wholePounds } from "./policy-labels";

// Policy detail at /account/policies/{reference} (6.2; Figma Policy overview 183:3507). "Make a
// change" and the Drivers card's "+ Add" and "Remove" (6.3b) show on a car policy that can be
// changed online. "Start a claim" (6.4) waits for its slice.

// The dialogs load when one opens: they bring the address lookup, the occupation list and Stripe
const ChangeDialogs = lazy(() =>
  import("#/features/policy-changes/ChangeDialogs").then((m) => ({ default: m.ChangeDialogs })),
);

export function PolicyDetailPage({
  policy,
  today,
  returnedChange = null,
}: {
  policy: PolicyDetail;
  today: string;
  /** The change a top-up's Stripe return names (?change=) */
  returnedChange?: string | null;
}) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const toast = useToast();
  const router = useRouter();
  const canChange = policy.changes.eligible;
  const returned =
    returnedChange && policy.changes.latest?.id === returnedChange ? policy.changes.latest : null;

  function applied() {
    setDialog(null);
    toast({ tone: "success", title: POLICY_UPDATED });
    void router.invalidate();
  }

  // A top-up left unpaid blocks other changes until it's cancelled or Stripe expires it (decision 7)
  const waiting =
    policy.changes.latest?.status === "awaiting_payment" ? policy.changes.latest : null;
  const [cancelling, setCancelling] = useState(false);
  // Whether Stripe has it paid: the webhook may be late (or, on a preview, never come), so the
  // page asks on load and applies it when it is (decision 7). Until then nothing is said.
  const [unpaid, setUnpaid] = useState(false);
  const waitingId = waiting?.id ?? null;
  useEffect(() => {
    if (!waitingId) return;
    let current = true;
    setUnpaid(false);
    void import("#/features/policy-changes/server")
      .then(({ checkMyTopUpFn }) => checkMyTopUpFn({ data: { changeId: waitingId } }))
      .then(({ status }) => {
        if (!current) return;
        if (status === "awaiting_payment") setUnpaid(true);
        else void router.invalidate();
      })
      .catch(() => current && setUnpaid(true));
    return () => {
      current = false;
    };
  }, [waitingId, router]);
  async function cancelWaiting() {
    if (!waiting) return;
    setCancelling(true);
    try {
      // Loaded on click, so the page itself doesn't carry the change dialogs' server code
      const { abandonMyPolicyChangeFn } = await import("#/features/policy-changes/server");
      await abandonMyPolicyChangeFn({ data: { input: { changeId: waiting.id } } });
      await router.invalidate();
    } finally {
      setCancelling(false);
    }
  }

  // Back from paying a top-up: the toast once it's applied
  const toasted = useRef(false);
  useEffect(() => {
    if (returned?.status === "applied" && !toasted.current) {
      toasted.current = true;
      toast({ tone: "success", title: POLICY_UPDATED });
    }
  }, [returned?.status, toast]);
  const status = rowStatus(policy, today);
  const documents = policyDocuments(policy, today);
  const excess = excessParts(policy);
  const { car, home } = policy;
  const reference = home
    ? `${policy.reference} · ${propertyTypeLabel(home.propertyType)}, ${home.postcode}`
    : car
      ? `${policy.reference} · ${car.variant}, ${car.year}`
      : policy.reference;

  return (
    <>
      {returned?.status === "failed" ? (
        <Alert tone="warning" className="pd__notice">
          <p>{REFUNDED_AFTER_CHANGE}</p>
        </Alert>
      ) : null}
      {waiting && unpaid && !returned ? (
        <Alert
          tone="info"
          className="pd__notice"
          action={
            <Button
              variant="ghost"
              size="sm"
              loading={cancelling}
              onClick={() => void cancelWaiting()}
            >
              Cancel this change
            </Button>
          }
        >
          <p>You started a change and haven't paid for it yet.</p>
        </Alert>
      ) : null}
      {returned?.status === "awaiting_payment" ? (
        <Alert tone="info" className="pd__notice">
          <p>We’re confirming your payment. Refresh the page in a moment to see your change.</p>
        </Alert>
      ) : null}
      <div className="pd__head">
        <Link to="/account/policies" className="pd__back">
          <Icon name="arrow-left" size={16} />
          All policies
        </Link>
        <div className="pd__title-row">
          <div className="pd__title-block">
            <div className="pd__tags">
              {car?.registration ? <span className="kb-plate">{car.registration}</span> : null}
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </div>
            <h1 className="account__title">{insuredName(policy)}</h1>
            <p className="pd__reference">{reference}</p>
          </div>
          {documents.includes("certificate") ? (
            <a
              href={documentHref(policy.reference, "certificate")}
              download={documentFilename(policy.reference, "certificate")}
              className="kb-btn kb-btn--secondary kb-btn--md pd__certificate"
            >
              <Icon name="download" size={16} />
              <span>Certificate</span>
            </a>
          ) : null}
        </div>
      </div>

      <div className="pd__stats">
        <Stat label="Cover" value={tierName(policy.coverLevel)} />
        <Stat
          label="Excess"
          info={
            <Tooltip content={excess.parts}>
              <Icon name="info" size={14} label="What makes up the excess" />
            </Tooltip>
          }
          value={excess.total}
        />
        {policy.plan.kind === "monthly" ? (
          <Stat
            label="Per month"
            value={formatPounds(policy.plan.instalmentPence)}
            sub={policy.bundled ? "Car and home together" : null}
          />
        ) : (
          <Stat label="A year" value={formatPounds(policy.annualPremiumPence)} />
        )}
        <DatesStat policy={policy} today={today} />
      </div>

      {canChange ? <MakeAChange onOpen={setDialog} /> : null}

      <div className="pd__details">
        {car ? <Drivers policy={policy} canChange={canChange} onOpen={setDialog} /> : null}
        {home ? <YourHome home={home} /> : null}
        <Card padding="md" as="section" className="pd__card" aria-labelledby="documents-title">
          <h2 id="documents-title" className="pd__card-title">
            Documents
          </h2>
          <DocumentList reference={policy.reference} kinds={documents} boughtOn={policy.boughtOn} />
        </Card>
      </div>

      {canChange && dialog ? (
        <Suspense fallback={null}>
          <ChangeDialogs
            dialog={dialog}
            policy={policy}
            onClose={() => setDialog(null)}
            onApplied={applied}
          />
        </Suspense>
      ) : null}
    </>
  );
}

const CHANGE_CARDS = [
  {
    kind: "driver_added",
    icon: "user-plus",
    title: "Add a driver",
    line: "Someone else who drives the car",
  },
  {
    kind: "address",
    icon: "map-pin",
    title: "Change address",
    line: "Where the car is kept overnight",
  },
  { kind: "cover", icon: "shield", title: "Change cover", line: "Your cover, extras and excess" },
] as const;

/** Figma's "Make a change" grid, with the three changes this slice makes (6.3b, decision 1) */
function MakeAChange({ onOpen }: { onOpen: (dialog: OpenDialog) => void }) {
  return (
    <section className="pd__changes" aria-labelledby="changes-title">
      <h2 id="changes-title" className="pd__section-title">
        Make a change
      </h2>
      <div className="pd__change-grid">
        {CHANGE_CARDS.map((card) => (
          <button
            key={card.kind}
            type="button"
            className="pd__change"
            onClick={() => onOpen({ kind: card.kind })}
          >
            <Icon name={card.icon} size={20} />
            <span className="pd__change-title">{card.title}</span>
            <span className="pd__change-line">{card.line}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  info = null,
  sub = null,
  tone,
  children,
}: {
  label: string;
  value: string;
  info?: ReactNode;
  sub?: string | null;
  tone?: "warning";
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <Card padding="md" className="pd__stat">
      <div role="group" aria-labelledby={id}>
        <div className="pd__stat-head">
          <p id={id} className="pd__stat-label">
            {label}
          </p>
          {info}
        </div>
        <p
          className={
            tone === "warning" ? "pd__stat-value pd__stat-value--warning" : "pd__stat-value"
          }
        >
          {value}
        </p>
        {sub ? <p className="pd__stat-sub">{sub}</p> : null}
        {children}
      </div>
    </Card>
  );
}

/** Renewal, or why there isn't one (6.2, decision 4) */
function DatesStat({ policy, today }: { policy: PolicyDetail; today: string }) {
  if (policy.status === "cancelled") {
    return <Stat label="Cancelled" value={longDay(policy.cancelledOn ?? policy.endsOn)} />;
  }
  if (policy.endsOn < today) return <Stat label="Ended" value={longDay(policy.endsOn)} />;
  if (policy.status === "lapsed") {
    return (
      <Stat label="Status" value="Lapsed" tone="warning">
        <p className="pd__stat-sub">
          Your payment didn’t go through. Update your card to restart your cover.
        </p>
        {policy.plan.kind === "monthly" ? (
          // A full page load, never a preload: /account/billing makes a Stripe portal session
          // each time it loads (5.6b, decision 9)
          <Link to="/account/billing" reloadDocument className="pd__stat-link">
            Manage payments
          </Link>
        ) : null}
      </Stat>
    );
  }
  if (policy.startsOn > today) return <Stat label="Starts" value={longDay(policy.startsOn)} />;
  return <Stat label="Renews" value={longDay(dayAfter(policy.endsOn))} />;
}

const initials = (driver: { firstName: string; lastName: string }) =>
  `${driver.firstName.charAt(0)}${driver.lastName.charAt(0)}`.toUpperCase();

/** A car policy holds the main driver and up to 4 named drivers (6.3b, decision 12) */
const NAMED_DRIVER_LIMIT = 4;

function Drivers({
  policy,
  canChange,
  onOpen,
}: {
  policy: PolicyDetail;
  canChange: boolean;
  onOpen: (dialog: OpenDialog) => void;
}) {
  const named = policy.drivers.filter((d) => !d.isMain).length;
  return (
    <Card padding="md" as="section" className="pd__card" aria-labelledby="drivers-title">
      <div className="pd__card-head">
        <h2 id="drivers-title" className="pd__card-title">
          Drivers
        </h2>
        {canChange && named < NAMED_DRIVER_LIMIT ? (
          <Button
            variant="ghost"
            size="sm"
            iconLeft="plus"
            onClick={() => onOpen({ kind: "driver_added" })}
          >
            Add
          </Button>
        ) : null}
      </div>
      <ul className="pd__list">
        {policy.drivers.map((driver) => (
          <li key={driver.id} className="pd__driver">
            <span className="pd__avatar" aria-hidden="true">
              {initials(driver)}
            </span>
            <div className="pd__driver-text">
              <p className="pd__driver-name">{fullName(driver)}</p>
              <p className="pd__driver-meta">{driverLine(driver)}</p>
            </div>
            {canChange && !driver.isMain ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${fullName(driver)}`}
                onClick={() =>
                  onOpen({ kind: "driver_removed", driverId: driver.id, name: fullName(driver) })
                }
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function YourHome({ home }: { home: NonNullable<PolicyDetail["home"]> }) {
  const rows: [string, string][] = [
    ["Rebuild cost", wholePounds(home.rebuildCostPence)],
    ["Contents", wholePounds(home.contentsValuePence)],
    ...(home.valuablesPence != null
      ? [["Valuables", wholePounds(home.valuablesPence)] as [string, string]]
      : []),
    ["Bedrooms", String(home.bedrooms)],
    ["Year built", String(home.yearBuilt)],
  ];
  return (
    <Card padding="md" as="section" className="pd__card" aria-labelledby="home-title">
      <h2 id="home-title" className="pd__card-title">
        Your home
      </h2>
      <dl className="pd__facts">
        {rows.map(([label, value]) => (
          <div key={label} className="pd__fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
