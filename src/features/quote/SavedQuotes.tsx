import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { formatPounds } from "#/features/rating/money";
import type { QuoteItemSummary, SavedQuoteCard, SavedQuoteState } from "#/server/data/quotes";

import { tierName } from "./labels";
import { StepHeading } from "./step-kit";

// Your saved quotes (5.6, decision 10; Figma 270:3759): the customer's own quotes, newest first. A
// ready quote goes on to Confirm and pay, a referred one waits for review (6.11), a bought one
// shows its policy and an expired one offers a new quote. The prices are the saved rows'. One
// product leads with its kind and puts the price beside it; a bundle shows a panel per product
// and puts the price in its footer.

const BADGES: Record<
  SavedQuoteState,
  { tone: "success" | "warning" | "info" | "neutral"; text: string }
> = {
  ready: { tone: "success", text: "Ready to buy" },
  review: { tone: "warning", text: "Under review" },
  bought: { tone: "info", text: "Bought" },
  expired: { tone: "neutral", text: "Expired" },
};

const PRODUCT = {
  car: { icon: "car", kind: "Car insurance", short: "Car" },
  home: { icon: "house", kind: "Home insurance", short: "Home" },
} as const;

const LINK = "kb-btn kb-btn--primary kb-btn--lg";

export function SavedQuotes({
  owner,
  cards,
}: {
  owner: { firstName: string; lastName: string };
  cards: SavedQuoteCard[];
}) {
  const name = `${owner.firstName} ${owner.lastName}`.trim();
  return (
    <div className="quote-page quote-saved">
      <StepHeading
        overline={name ? `Saved quotes · ${name}` : "Saved quotes"}
        title="My quotes"
        intro="Pick up a quote or find your purchased cover."
      />
      {cards.length === 0 ? (
        <Card padding="lg" as="section" aria-label="No saved quotes" className="quote-saved__empty">
          <p className="quote-saved__subtitle">You don’t have any saved quotes yet.</p>
          <div>
            <Link to="/quote" className={LINK}>
              Get a quote
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="quote-saved__list">
          {cards.map((card) => (
            <li key={card.quoteId}>
              <QuoteCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteCard({ card }: { card: SavedQuoteCard }) {
  // A bundle shows a panel per product (5.7b, decision 8)
  const bundle = card.items.length > 1;
  const item = card.items[0]!;
  const badge = BADGES[card.state];
  const reference = <p className="quote-saved__ref">Quote {card.reference}</p>;
  return (
    <Card
      padding="lg"
      as="article"
      className="quote-saved__card"
      aria-label={`Quote ${card.reference}`}
    >
      <div className="quote-saved__head">
        {bundle ? (
          <div className="quote-saved__identity">
            <h2 className="quote-saved__title">Car + home bundle</h2>
            {reference}
          </div>
        ) : (
          <div className="quote-saved__product">
            <span className="quote-saved__tile">
              <Icon name={PRODUCT[item.product].icon} size={24} />
            </span>
            <p className="quote-saved__overline">{PRODUCT[item.product].kind}</p>
          </div>
        )}
        <Badge tone={badge.tone} dot>
          {badge.text}
        </Badge>
      </div>
      {bundle ? (
        <>
          <ul className="quote-saved__panels">
            {card.items.map((i) => (
              <li key={i.product}>
                <ItemPanel item={i} />
              </li>
            ))}
          </ul>
          <hr className="quote-saved__divider" />
        </>
      ) : (
        <div className="quote-saved__main">
          <div className="quote-saved__identity">
            <h2 className="quote-saved__title">{itemName(item)}</h2>
            {itemMeta(item) ? <p className="quote-saved__meta">{itemMeta(item)}</p> : null}
            {reference}
          </div>
          {card.state === "ready" ? <Price card={card} /> : null}
        </div>
      )}
      <Footer card={card} bundle={bundle} />
    </Card>
  );
}

function itemName(item: QuoteItemSummary): string {
  if (item.car) return `${item.car.make} ${item.car.model} ${item.car.variant}`.trim();
  return item.home?.addressLine1 ?? "";
}

/** "VW21 GOL · Comprehensive", or the town for a home; parts that are missing are left out */
function itemMeta(item: QuoteItemSummary): string {
  const where = item.car ? item.car.registration : item.home?.town;
  return [where, item.coverLevel ? tierName(item.coverLevel) : null].filter(Boolean).join(" · ");
}

/** One product of a bundle: the car by make and model over its variant, the home by address */
function ItemPanel({ item }: { item: QuoteItemSummary }) {
  const [title, sub] = item.car
    ? [`${item.car.make} ${item.car.model}`, item.car.variant]
    : [item.home?.addressLine1 ?? "", item.home?.town ?? ""];
  return (
    <div className="quote-saved__panel">
      <div className="quote-saved__panel-label">
        <Icon name={PRODUCT[item.product].icon} size={24} />
        <p className="quote-saved__overline">{PRODUCT[item.product].short}</p>
      </div>
      <div className="quote-saved__panel-text">
        <h3 className="quote-saved__subtitle">{title}</h3>
        {sub ? <p className="quote-saved__meta">{sub}</p> : null}
      </div>
    </div>
  );
}

function Price({ card }: { card: SavedQuoteCard }) {
  if (card.annualTotalPence === null) return null;
  return (
    <div className="quote-saved__price">
      <p className="quote-saved__annual">
        <span className="quote-saved__amount">{formatPounds(card.annualTotalPence)}</span> a year
      </p>
      {card.monthlyPaymentPence !== null ? (
        <p className="quote-saved__small">
          Or 12 payments of {formatPounds(card.monthlyPaymentPence)}
        </p>
      ) : null}
      <p className="quote-saved__caption">Includes Insurance Premium Tax</p>
    </div>
  );
}

function Footer({ card, bundle }: { card: SavedQuoteCard; bundle: boolean }) {
  switch (card.state) {
    case "ready":
      return (
        <div className="quote-saved__foot">
          <div className="quote-saved__foot-text">
            {bundle ? <Price card={card} /> : null}
            <p className="quote-saved__note">
              Price saved for 30 days from issue, provided your details stay the same.
            </p>
          </div>
          <Link to="/quote/pay/$quoteId" params={{ quoteId: card.quoteId }} className={LINK}>
            <span>Continue quote</span>
            <Icon name="arrow-right" size={18} />
          </Link>
        </div>
      );
    case "review":
      return (
        <div className="quote-saved__foot">
          <p className="quote-saved__note">
            We need to check a couple of things before we can offer cover.
          </p>
        </div>
      );
    case "bought":
      return (
        <div className="quote-saved__foot">
          <div className="quote-saved__foot-text">
            <p className="quote-saved__small">
              {card.policyReferences.length > 1 ? "Your policies" : "Your policy"}
            </p>
            <p className="quote-saved__policies">{card.policyReferences.join(" and ")}</p>
          </div>
          <Link to="/account" className={LINK}>
            <span>Go to my account</span>
            <Icon name="arrow-right" size={18} />
          </Link>
        </div>
      );
    case "expired":
      return (
        <div className="quote-saved__foot">
          <p className="quote-saved__note">
            This quote’s saved-price period has ended. Get a new quote with your current details.
          </p>
          <Link
            to="/quote"
            search={{ type: card.items[0]!.product, postcode: card.postcode }}
            className={LINK}
          >
            <span>Start a new quote</span>
            <Icon name="arrow-right" size={18} />
          </Link>
        </div>
      );
    default: {
      const unhandled: never = card.state;
      return unhandled;
    }
  }
}
