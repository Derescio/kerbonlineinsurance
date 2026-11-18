import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { Tag } from "#/components/display/Tag";
import { cx } from "#/lib/cx";

import { isBuyable, quoteTypes, type BuyableProductId } from "./products";
import type { ComingSoonSearch } from "./search";

const comingSoon = quoteTypes.filter(({ id }) => !isBuyable(id));

/** "Landlord, pet, condo, business and tenant" */
const comingSoonList = comingSoon
  .map(({ label }, i) => (i === 0 ? label : label.toLowerCase()))
  .join(", ")
  .replace(/, ([^,]*)$/, " and $1");

const offers: {
  product: BuyableProductId;
  icon: IconName;
  title: string;
  body: string;
  variant: "accent" | "secondary";
}[] = [
  {
    product: "car",
    icon: "car",
    title: "Car insurance",
    body: "Cover for your car, with clear options and no jargon.",
    variant: "accent",
  },
  {
    product: "home",
    icon: "house",
    title: "Home insurance",
    body: "Protect your home and the things you keep in it.",
    variant: "secondary",
  },
];

/** Straight into the journey with a postcode; without one, the start with the type picked */
function OfferLink({
  product,
  postcode,
  variant,
}: {
  product: BuyableProductId;
  postcode?: string;
  variant: "accent" | "secondary";
}) {
  const className = cx("kb-btn", `kb-btn--${variant}`, "kb-btn--md");
  const label = <span>Get a {product} quote</span>;
  return postcode ? (
    <Link to={`/quote/${product}`} search={{ postcode }} className={className}>
      {label}
    </Link>
  ) : (
    <Link to="/quote" search={{ type: product }} className={className}>
      {label}
    </Link>
  );
}

/**
 * Coming soon, screen 02 (Figma 222:6717): the five types Kerb doesn't sell yet, with car and home
 * offered instead. The postcode, if one was given, is carried into either (5.1, call 5).
 */
export function ComingSoon({ search }: { search: ComingSoonSearch }) {
  const { type, postcode } = search;
  return (
    <div className="quote-page">
      <header className="quote-heading">
        <p className="quote-heading__overline">More cover, on the way</p>
        <h1 className="kb-h1 quote-heading__title">More ways to cover your world</h1>
        <p className="quote-heading__intro">
          These five types aren&rsquo;t available to buy yet. You can still get a car or home quote
          today.
        </p>
      </header>

      <Card as="section" padding="lg" className="quote-soon" aria-labelledby="quote-soon-title">
        <Badge>Coming soon</Badge>
        <h2 className="kb-h3 quote-soon__title" id="quote-soon-title">
          We&rsquo;re getting these ready for you
        </h2>
        <p className="quote-soon__body">
          {comingSoonList} insurance are coming soon. Online quotes and purchases aren&rsquo;t
          available for these types yet.
        </p>
        <ul className="quote-soon__types">
          {comingSoon.map(({ id, label }) => (
            <li key={id}>
              <Tag selected={id === type}>
                {label}
                {id === type ? <span className="kb-sr-only"> (your choice)</span> : null}
              </Tag>
            </li>
          ))}
        </ul>
      </Card>

      <section className="quote-offers" aria-labelledby="quote-offers-title">
        <h2 className="kb-h2 quote-offers__title" id="quote-offers-title">
          In the meantime, start with&hellip;
        </h2>
        <div className="quote-offers__grid">
          {offers.map((offer) => (
            <Card key={offer.product} padding="lg" className="quote-offer">
              <Icon name={offer.icon} size={24} />
              <h3 className="kb-h3 quote-offer__title">{offer.title}</h3>
              <p className="quote-offer__body">{offer.body}</p>
              <OfferLink product={offer.product} postcode={postcode} variant={offer.variant} />
            </Card>
          ))}
        </div>
      </section>

      <Link to="/quote" search={postcode ? { postcode } : {}} className="quote-back">
        Back to all insurance types
      </Link>
      {postcode ? (
        <p className="quote-start__note">
          Your postcode, {postcode}, will be kept if you choose car or home.
        </p>
      ) : null}
    </div>
  );
}
