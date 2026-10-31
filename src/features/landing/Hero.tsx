import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Input } from "#/components/forms/Input";
import { quoteHref, retrieveQuoteLink } from "#/components/site/links";
import { normalisePostcode, postcodeError } from "#/features/quote/postcode";

import { HeroImage } from "./HeroImage";

/**
 * Split hero (Figma 54:1952 web, 88:2274 tablet, 88:2542 mobile): copy and the postcode quote
 * form, then the home-and-car photo. The form is a plain GET to /quote, so it works before
 * hydration; with JS it checks the postcode first and sends it normalised.
 */
export function Hero() {
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const field = input.current;
    if (!field) return;
    const postcode = normalisePostcode(field.value);
    if (postcode === null) {
      e.preventDefault();
      setError(postcodeError);
      field.focus();
      return;
    }
    // Let the browser submit, with the tidy value. Phase 5 swaps this for a router navigation.
    field.value = postcode;
  }

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="site-container hero__grid">
        <div className="hero__copy">
          <p className="hero__overline">Online insurance</p>
          <h1 className="hero__title" id="hero-title">
            Kerb Online Insurance.
          </h1>
          <p className="hero__intro">
            Get a price in about two minutes. Every term is explained as you go, so you know exactly
            what you're paying for before you buy.
          </p>

          <form
            className="hero__form"
            method="get"
            action={quoteHref}
            noValidate
            onSubmit={onSubmit}
          >
            <div className="hero__row">
              <Input
                ref={input}
                label="Your postcode"
                name="postcode"
                iconLeft="map-pin"
                placeholder="e.g. E8 3RL"
                autoComplete="postal-code"
                autoCapitalize="characters"
                spellCheck={false}
                error={error}
                onChange={() => setError(undefined)}
              />
              <Button type="submit" variant="accent" size="lg" iconRight="arrow-right">
                Get a quote
              </Button>
            </div>
            <div className="hero__note">
              <span>Takes about two minutes. No account needed.</span>
              <a href={retrieveQuoteLink.href}>{retrieveQuoteLink.label}</a>
            </div>
          </form>
        </div>

        <HeroImage className="hero__photo" />
      </div>
    </section>
  );
}
