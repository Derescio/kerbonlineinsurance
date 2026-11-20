import { Link, useNavigate } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { tierName } from "#/features/quote/labels";
import { startFromAccount } from "#/features/quote/journey-store";
import { savingSentence } from "#/features/quote/multi-policy";
import { todayIso } from "#/features/quote/schemas/dates";
import { formatPounds } from "#/features/rating/money";
import type { AccountCustomer } from "#/server/data/multi-policy";
import type { NextPayment, PolicyListItem } from "#/server/data/policies";

import type { AddOffer } from "./add-product";

import {
  carAndHome,
  greetingLine,
  groupByBundle,
  isCovered,
  isHeld,
  overviewStats,
  rowStatus,
  shortDay,
  type CarAndHome,
} from "./overview-model";

// The Overview at /account (6.1; Figma 01 258:3608, 02 258:3635, 03 258:3659): a greeting, the stat
// cards and the customer's policies by what they insure. Open claims come in 6.6. The add-product
// card is 6.1b.

export function Overview({
  name,
  policies,
  nextPayment,
  now,
  offers = [],
  customer = null,
}: {
  name: string;
  policies: PolicyListItem[];
  nextPayment: NextPayment;
  /** From the loader, so the server and the browser render the same day (and greeting) */
  now: Date;
  /** A card for each buyable product this customer doesn't hold (6.1b) */
  offers?: AddOffer[];
  /** The record a card copies into the new journey. Null before a first quote is saved. */
  customer?: AccountCustomer | null;
}) {
  const today = todayIso(now);
  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const covered = policies.some((p) => isCovered(p, today));
  const stats = overviewStats(policies, today);
  const savingPence = stats.bundleSavingPence + stats.earnedSavingPence;

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
              savingPence > 0
                ? `after your ${formatPounds(savingPence)} ${stats.earnedSavingPence ? "saving" : "bundle saving"}`
                : null
            }
          />
        </div>
      ) : null}
      <YourPolicies
        policies={policies}
        today={today}
        celebrate={carAndHome(policies, stats, today)}
      />
      <AddProduct offers={offers} customer={customer} />
    </>
  );
}

function AddProduct({
  offers,
  customer,
}: {
  offers: AddOffer[];
  customer: AccountCustomer | null;
}) {
  const navigate = useNavigate();
  if (offers.length === 0 || !customer) return null;
  return (
    <div className="ovw__adds">
      {offers.map((offer) => {
        const addingHome = offer.product === "home";
        const label = addingHome ? "Add home insurance" : "Add car insurance";
        return (
          <Card key={offer.product} padding="lg" as="section" className="ovw__add">
            {offer.savingRate != null ? (
              <p>{savingSentence(addingHome ? "car" : "home", offer.savingRate)}</p>
            ) : null}
            <button
              type="button"
              className="kb-btn kb-btn--accent kb-btn--md"
              onClick={() => {
                startFromAccount(offer.product, {
                  firstName: customer.firstName,
                  lastName: customer.lastName,
                  dateOfBirth: customer.dateOfBirth,
                  addressLine1: customer.addressLine1,
                  addressLine2: customer.addressLine2 ?? undefined,
                  town: customer.town,
                  postcode: customer.postcode,
                });
                void navigate({
                  to: addingHome ? "/quote/home" : "/quote/car",
                  search: { postcode: customer.postcode },
                });
              }}
            >
              <span>{label}</span>
            </button>
          </Card>
        );
      })}
    </div>
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

function YourPolicies({
  policies,
  today,
  celebrate,
}: {
  policies: PolicyListItem[];
  today: string;
  /** The car + home banner, which stands in for the bundles' own headings */
  celebrate: CarAndHome | null;
}) {
  return (
    <Card padding="lg" as="section" className="ovw__policies" aria-labelledby="policies-title">
      <div className="ovw__policies-head">
        <h2 id="policies-title" className="ovw__title">
          Your policies
        </h2>
        <Link to="/quote/retrieve" className="kb-btn kb-btn--secondary kb-btn--md">
          <span>My quotes</span>
        </Link>
      </div>
      {policies.length === 0 ? (
        <div className="ovw__empty">
          <p>You don’t have any policies yet.</p>
          <Link to="/quote" className="kb-btn kb-btn--accent kb-btn--md">
            <span>Get a quote</span>
          </Link>
        </div>
      ) : celebrate ? (
        <>
          <CarAndHomeBanner {...celebrate} />
          <ul className="ovw__list">
            {groupByBundle(policies)
              .flatMap((group) => group.policies)
              .map((policy) => (
                <PolicyRow key={policy.id} policy={policy} today={today} />
              ))}
          </ul>
        </>
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

/** A whole-pound saving drops the pence, as the frame's "£96" does */
const savingPounds = (pence: number) => formatPounds(pence).replace(/\.00$/, "");

function bannerLine(savedOn: CarAndHome["savedOn"]): string {
  switch (savedOn) {
    case "home":
      return "Your home insurance costs less because you already insure your car with us.";
    case "car":
      return "Your car insurance costs less because you already insure your home with us.";
    case "both":
      return "Covered together, so you pay less for both.";
    case null:
      return "Your car and home are covered. One less thing to think about.";
    default: {
      const unhandled: never = savedOn;
      return unhandled;
    }
  }
}

/** Car + home, celebrated (Figma 258:3711), with the yearly saving when there is one */
function CarAndHomeBanner({ savingPence, savedOn }: CarAndHome) {
  return (
    <div role="group" aria-labelledby="car-home-title" className="ovw__celebrate">
      <div className="ovw__celebrate-main">
        <div className="ovw__celebrate-eyebrow">
          <span className="ovw__celebrate-tile" aria-hidden="true">
            <Icon name="car" size={24} />
          </span>
          <span className="ovw__celebrate-tile" aria-hidden="true">
            <Icon name="house" size={24} />
          </span>
          <p className="ovw__overline">Bundle activated</p>
        </div>
        <h3 id="car-home-title" className="ovw__celebrate-title">
          Car + home. Better together.
        </h3>
        <p className="ovw__celebrate-text">{bannerLine(savedOn)}</p>
      </div>
      {savingPence > 0 ? (
        <div className="ovw__celebrate-saving">
          <p className="ovw__overline">A little bundle brilliance</p>
          <p className="ovw__celebrate-amount">{savingPounds(savingPence)}</p>
          <p className="ovw__celebrate-every">saved every year</p>
          <p className="ovw__celebrate-note">Already included in your price</p>
        </div>
      ) : null}
    </div>
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
