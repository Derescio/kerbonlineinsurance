import { quoteHref, retrieveQuoteLink } from "#/components/site/links";

import { ButtonLink } from "./ButtonLink";

/** Closing CTA card (Figma 54:2089 web; mobile in 88:2725). */
export function ClosingCta() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="site-container">
        <div className="closing__card">
          <div className="closing__copy">
            <h2 className="closing__title" id="closing-title">
              See your price in two minutes.
            </h2>
            <p className="closing__body">No account needed. We'll save your quote for 30 days.</p>
          </div>
          <div className="closing__actions">
            <ButtonLink href={quoteHref} variant="accent" size="lg" className="closing__cta">
              Get a quote
            </ButtonLink>
            <a href={retrieveQuoteLink.href} className="closing__saved">
              {retrieveQuoteLink.label}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
