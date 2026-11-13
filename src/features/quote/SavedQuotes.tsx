import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { formatPounds } from "#/features/rating/money";
import type { SavedQuoteCard, SavedQuoteState } from "#/server/data/quotes";

import { tierName } from "./labels";
import { StepHeading } from "./step-kit";

// Your saved quotes (5.6, decision 10; screen 17): the customer's own quotes, newest first. A
// ready quote goes on to Confirm and pay, a referred one waits for review (6.11), a bought one
// shows its policy and an expired one offers a new quote. The prices are the saved rows'.

const BADGES: Record<
  SavedQuoteState,
  { tone: "success" | "warning" | "info" | "neutral"; text: string }
> = {
  ready: { tone: "success", text: "Ready to buy" },
  review: { tone: "warning", text: "Under review" },
  bought: { tone: "info", text: "Bought" },
  expired: { tone: "neutral", text: "Expired" },
};

const LINK = "kb-btn kb-btn--primary kb-btn--md";

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
        title="Your saved quotes"
      />
      {cards.length === 0 ? (
        <Card padding="lg" as="section" aria-label="No saved quotes" className="quote-saved__empty">
          <p className="quote-outcome__name">You don’t have any saved quotes yet.</p>
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
  const { car } = card;
  const badge = BADGES[card.state];
  const meta = [car.registration, tierName(card.coverLevel), card.reference]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card
      padding="lg"
      as="article"
      className="quote-saved__card"
      aria-label={`Quote ${card.reference}`}
    >
      <div className="quote-saved__head">
        <div>
          <h2 className="quote-outcome__name">{`${car.make} ${car.model} ${car.variant}`}</h2>
          <p className="quote-outcome__meta">{meta}</p>
        </div>
        <Badge tone={badge.tone} dot>
          {badge.text}
        </Badge>
      </div>
      <Body card={card} />
    </Card>
  );
}

function Body({ card }: { card: SavedQuoteCard }) {
  if (card.state === "ready") {
    return (
      <>
        <div>
          {card.annualTotalPence !== null ? (
            <p className="quote-outcome__total">{formatPounds(card.annualTotalPence)}</p>
          ) : null}
          {card.monthlyPaymentPence !== null ? (
            <p className="quote-outcome__meta">
              Or 12 payments of {formatPounds(card.monthlyPaymentPence)} · Includes Insurance
              Premium Tax
            </p>
          ) : null}
        </div>
        <p className="quote-outcome__small">
          Price saved for 30 days from issue, provided your details stay the same.
        </p>
        <div>
          <Link to="/quote/pay/$quoteId" params={{ quoteId: card.quoteId }} className={LINK}>
            Continue quote
          </Link>
        </div>
      </>
    );
  }
  if (card.state === "review") {
    return <p>We need to check a couple of things before we can offer cover.</p>;
  }
  if (card.state === "bought") {
    return (
      <>
        <p>Policy {card.policyReference}</p>
        <div>
          <Link to="/account" className={LINK}>
            Go to my account
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <p>This quote’s saved-price period has ended. Get a new quote with your current details.</p>
      <div>
        <Link to="/quote" search={{ type: "car", postcode: card.postcode }} className={LINK}>
          Start a new quote
        </Link>
      </div>
    </>
  );
}
