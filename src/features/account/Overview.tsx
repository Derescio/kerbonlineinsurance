import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { londonDate } from "#/lib/london-date";
import { tierName } from "#/features/quote/labels";
import { formatPounds } from "#/features/rating/money";
import type { NextPayment, PolicyListItem } from "#/server/data/policies";

import {
  greetingLine,
  groupByBundle,
  isCovered,
  isHeld,
  overviewStats,
  rowStatus,
  shortDay,
} from "./overview-model";

// The Overview at /account (6.1; Figma 01 258:3608, 02 258:3635, 03 258:3659): a greeting, the stat
// cards and the customer's policies by what they insure. Open claims (6.6) and the add-product card
// (6.1b) come later.

export function Overview({
  name,
  policies,
  nextPayment,
  now,
}: {
  name: string;
  policies: PolicyListItem[];
  nextPayment: NextPayment;
  /** From the loader, so the server and the browser render the same day (and greeting) */
  now: Date;
}) {
  const today = londonDate(now);
  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const covered = policies.some((p) => isCovered(p, today));
  const stats = overviewStats(policies, today);

  return (
    <>
      <div>
        <p className="ovw__date">{greetingLine(now)}</p>
        <h1 className="account__title">
          Hi{firstName ? ` ${firstName}` : ""}
          {covered ? ", you’re covered." : ""}
        </h1>
      </div>
      {stats.held > 0 ? (
        <div className="ovw__stats">
          <Stat label="Policies" value={String(stats.held)} />
          <NextPaymentStat
            next={nextPayment}
            manage={policies.some((p) => p.monthly && isHeld(p, today))}
          />
          <Stat
            label="A year"
            value={formatPounds(stats.yearPence)}
            sub={
              stats.bundleSavingPence > 0
                ? `after your ${formatPounds(stats.bundleSavingPence)} bundle saving`
                : null
            }
          />
        </div>
      ) : null}
      <YourPolicies policies={policies} today={today} />
    </>
  );
}

function Stat({
  label,
  value,
  sub = null,
  tone,
  children,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "warning";
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <Card padding="md" className="ovw__stat">
      <div role="group" aria-labelledby={id}>
        <p id={id} className="ovw__stat-label">
          {label}
        </p>
        <p
          className={
            tone === "warning" ? "ovw__stat-value ovw__stat-value--warning" : "ovw__stat-value"
          }
        >
          {value}
        </p>
        {sub ? <p className="ovw__stat-sub">{sub}</p> : null}
        {children}
      </div>
    </Card>
  );
}

function NextPaymentStat({ next, manage }: { next: NextPayment; manage: boolean }) {
  const link = manage ? (
    // A full page load, never a preload: /account/billing makes a Stripe portal session each time
    // it loads (5.6b, decision 9)
    <Link to="/account/billing" reloadDocument className="ovw__stat-link">
      Manage payments
    </Link>
  ) : null;
  if (next.kind === "overdue") {
    return (
      <Stat
        label="Next payment"
        value="Payment due"
        tone="warning"
        sub={`${formatPounds(next.outstandingPence)} outstanding`}
      >
        {link}
      </Stat>
    );
  }
  if (next.kind === "due") {
    return (
      <Stat
        label="Next payment"
        value={formatPounds(next.amountPence)}
        sub={`on ${shortDay(next.dueOn)}`}
      >
        {link}
      </Stat>
    );
  }
  return (
    <Stat label="Next payment" value="All paid for this year">
      {link}
    </Stat>
  );
}

function YourPolicies({ policies, today }: { policies: PolicyListItem[]; today: string }) {
  return (
    <Card padding="lg" as="section" className="ovw__policies" aria-labelledby="policies-title">
      <div className="ovw__policies-head">
        <h2 id="policies-title" className="ovw__title">
          Your policies
        </h2>
        <Link to="/quote/retrieve" className="kb-btn kb-btn--secondary kb-btn--md">
          <span>Your saved quotes</span>
        </Link>
      </div>
      {policies.length === 0 ? (
        <div className="ovw__empty">
          <p>You don’t have any policies yet.</p>
          <Link to="/quote" className="kb-btn kb-btn--accent kb-btn--md">
            <span>Get a quote</span>
          </Link>
        </div>
      ) : (
        <ul className="ovw__list">
          {groupByBundle(policies).map((group) =>
            group.bundle ? (
              <li key={group.bundle.id}>
                <div
                  role="group"
                  aria-labelledby={`bundle-${group.bundle.id}`}
                  className="ovw__bundle"
                >
                  <div className="ovw__bundle-head">
                    <span className="ovw__bundle-icons" aria-hidden="true">
                      <Icon name="car" size={20} />
                      <Icon name="house" size={20} />
                    </span>
                    <div>
                      <p id={`bundle-${group.bundle.id}`} className="ovw__bundle-title">
                        Car + home bundle
                      </p>
                      {group.bundle.savingPence ? (
                        <p className="ovw__bundle-saving">
                          You save {formatPounds(group.bundle.savingPence)} a year
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <ul className="ovw__list">
                    {group.policies.map((policy) => (
                      <PolicyRow key={policy.id} policy={policy} today={today} />
                    ))}
                  </ul>
                </div>
              </li>
            ) : (
              <PolicyRow key={group.policies[0]!.id} policy={group.policies[0]!} today={today} />
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

/** What the policy insures: the plate (or an icon) to lead the row, and the car or the address */
function insured(policy: PolicyListItem): { lead: ReactNode; name: string } {
  const { label } = policy;
  const icon = (name: "car" | "house") => <Icon name={name} size={24} className="ovw__row-icon" />;
  if (label?.kind === "car") {
    return {
      lead: label.plate ? <span className="kb-plate">{label.plate}</span> : icon("car"),
      name: `${label.make} ${label.model}`,
    };
  }
  if (label?.kind === "home") return { lead: icon("house"), name: `${label.line1}, ${label.town}` };
  return { lead: icon(policy.product === "home" ? "house" : "car"), name: policy.reference };
}

function PolicyRow({ policy, today }: { policy: PolicyListItem; today: string }) {
  const status = rowStatus(policy, today);
  const { lead, name } = insured(policy);
  return (
    <li className="ovw__row">
      <div className="ovw__row-lead">{lead}</div>
      <div className="ovw__row-main">
        <p className="ovw__row-name">{name}</p>
        <p className="ovw__row-meta">{tierName(policy.coverLevel)}</p>
        {policy.status === "lapsed" && status.label === "Lapsed" ? (
          <p className="ovw__row-meta">
            Your payment didn’t go through. Update your card to restart your cover.
          </p>
        ) : null}
      </div>
      <div className="ovw__row-status">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        {status.date ? <p className="ovw__row-meta">{status.date}</p> : null}
      </div>
    </li>
  );
}
