import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

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

// Policy detail at /account/policies/{reference} (6.2; Figma Policy overview 183:3507). "Start a
// claim" (6.4), "Make a change" and the Drivers card's "+ Add" (6.3) wait for their slices.

export function PolicyDetailPage({ policy, today }: { policy: PolicyDetail; today: string }) {
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

      <div className="pd__details">
        {car ? <Drivers policy={policy} /> : null}
        {home ? <YourHome home={home} /> : null}
        <Card padding="md" as="section" className="pd__card" aria-labelledby="documents-title">
          <h2 id="documents-title" className="pd__card-title">
            Documents
          </h2>
          <DocumentList reference={policy.reference} kinds={documents} boughtOn={policy.boughtOn} />
        </Card>
      </div>
    </>
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

function Drivers({ policy }: { policy: PolicyDetail }) {
  return (
    <Card padding="md" as="section" className="pd__card" aria-labelledby="drivers-title">
      <h2 id="drivers-title" className="pd__card-title">
        Drivers
      </h2>
      <ul className="pd__list">
        {policy.drivers.map((driver) => (
          <li key={`${driver.firstName} ${driver.lastName}`} className="pd__driver">
            <span className="pd__avatar" aria-hidden="true">
              {initials(driver)}
            </span>
            <div>
              <p className="pd__driver-name">{fullName(driver)}</p>
              <p className="pd__driver-meta">{driverLine(driver)}</p>
            </div>
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
