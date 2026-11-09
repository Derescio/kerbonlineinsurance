import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Input } from "#/components/forms/Input";
import { quoteHref, retrieveQuoteLink } from "#/components/site/links";
import { normalisePostcode, postcodeError } from "#/features/quote/postcode";
import { getFlag, track } from "#/lib/analytics";

import { HeroImage } from "./HeroImage";

// Hero CTA copy experiment (3.5): PostHog flag "hero-cta-copy". The server HTML is CDN-cached and the
// same for everyone, so it always has the control; a visitor who has accepted cookies may get the
// other label once flags load. Anything else (no consent, flags slow or failing) keeps the control.
export const ctaLabels = { control: "Get a quote", "see-my-price": "See my price" } as const;
type CtaVariant = keyof typeof ctaLabels;
const ctaVariants = Object.keys(ctaLabels) as CtaVariant[];

function isCtaVariant(value: unknown): value is CtaVariant {
  return typeof value === "string" && value in ctaLabels;
}

/**
 * Split hero (Figma 54:1952 web, 88:2274 tablet, 88:2542 mobile): copy and the postcode quote
 * form, then the home-and-car photo. The form is a plain GET to /quote, so it works before
 * hydration; with JS it checks the postcode first and sends it normalised. The Phase 4 hero refresh
 * brought the headline, the form heading and the framed photo, and dropped the 3.3 excess callout.
 */
export function Hero() {
  const [error, setError] = useState<string>();
  const [cta, setCta] = useState<CtaVariant>("control");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void getFlag("hero-cta-copy").then((variant) => {
      if (current && isCtaVariant(variant)) setCta(variant);
    });
    return () => {
      current = false;
    };
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const field = input.current;
    if (!field) return;
    const postcode = normalisePostcode(field.value);
    if (postcode === null) {
      track("quote_start_blocked", { entry_point: "hero_postcode_form" });
      e.preventDefault();
      setError(postcodeError);
      field.focus();
      return;
    }
    // Let the browser submit, with the tidy value. Phase 5 swaps this for a router navigation.
    field.value = postcode;
    track("quote_started", { entry_point: "hero_postcode_form" });
  }

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="site-container hero__grid">
        <div className="hero__copy">
          <p className="hero__overline">Online insurance</p>
          <h1 className="hero__title" id="hero-title">
            Insurance made <span className="hero__title-mark">simpler.</span>
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
            <h2 className="hero__form-title">Let's get you covered.</h2>
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
                {/* Both labels share one grid cell, so the button is as wide as the longer one and
                    the swap can't shift the layout. The hidden one isn't in the accessible name. */}
                <span className="hero__cta">
                  {ctaVariants.map((variant) => (
                    <span
                      key={variant}
                      className={variant === cta ? undefined : "hero__cta-spare"}
                      aria-hidden={variant === cta ? undefined : true}
                    >
                      {ctaLabels[variant]}
                    </span>
                  ))}
                </span>
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
