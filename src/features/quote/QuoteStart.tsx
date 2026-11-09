import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Input } from "#/components/forms/Input";
import { quoteHref, retrieveQuoteLink } from "#/components/site/links";

import { isBuyable, type ProductId } from "./products";
import { checkStart, type StartSearch } from "./search";
import { TypePicker } from "./TypePicker";

const linkHint = "Added from your link. You can change it here.";

/** Screen 01 keeps the landing's link but labels it for this page (5.1, call 8) */
const retrieveLabel = "Retrieve a saved quote";

type Errors = { type?: string; postcode?: string };

function initialErrors(search: StartSearch): Errors {
  if (!search.next) return {};
  const check = checkStart(search);
  return check.ok ? {} : check.errors;
}

/**
 * Quote start, screen 01 (Figma 222:6702): what to insure and the postcode, either filled from
 * the link. A plain GET to /quote with `next=1`, so it works before hydration: the route checks
 * the inputs and redirects, or renders the errors (5.1, call 7). With JavaScript the same check
 * runs here and Continue navigates without a reload.
 */
export function QuoteStart({ search }: { search: StartSearch }) {
  const navigate = useNavigate();
  const [type, setType] = useState<ProductId | undefined>(search.type);
  const [postcode, setPostcode] = useState(search.postcode ?? "");
  const [errors, setErrors] = useState<Errors>(() => initialErrors(search));
  const form = useRef<HTMLFormElement>(null);
  const postcodeField = useRef<HTMLInputElement>(null);

  const buyable = type !== undefined && isBuyable(type);
  const fromLink = !search.next && search.postcode !== undefined && postcode === search.postcode;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = checkStart({ type, postcode });
    if (check.ok) {
      void navigate({ to: check.to, search: check.search });
      return;
    }
    setErrors(check.errors);
    if (check.errors.type) {
      const radios = form.current?.querySelectorAll<HTMLInputElement>('input[name="type"]');
      const checked = form.current?.querySelector<HTMLInputElement>('input[name="type"]:checked');
      (checked ?? radios?.[0])?.focus();
    } else postcodeField.current?.focus();
  }

  return (
    <div className="quote-page">
      <header className="quote-heading">
        <p className="quote-heading__overline">Get a quote</p>
        <h1 className="kb-h1 quote-heading__title">What would you like to insure?</h1>
        <p className="quote-heading__intro">
          Choose a type of cover to get started. Car and home are available to buy online.
        </p>
      </header>

      <form
        ref={form}
        className="quote-start"
        method="get"
        action={quoteHref}
        noValidate
        onSubmit={onSubmit}
      >
        <input type="hidden" name="next" value="1" />
        <TypePicker
          value={type}
          error={errors.type}
          onChange={(id) => {
            setType(id);
            setErrors((current) => ({ ...current, type: undefined }));
          }}
        />

        <div className="quote-start__postcode">
          <Input
            ref={postcodeField}
            label="Your postcode"
            name="postcode"
            optional={type !== undefined && !buyable}
            placeholder="e.g. E8 3RL"
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            value={postcode}
            hint={fromLink ? linkHint : undefined}
            error={errors.postcode}
            onChange={(e) => {
              setPostcode(e.target.value);
              setErrors((current) => ({ ...current, postcode: undefined }));
            }}
          />
          <p className="quote-start__why">
            We&rsquo;ll use your postcode to find your address and work out your quote.
          </p>
        </div>

        <div className="quote-start__actions">
          <Button type="submit" variant="accent" size="lg">
            {buyable ? `Continue with ${type}` : "Continue"}
          </Button>
          <a href={retrieveQuoteLink.href} className="kb-btn kb-btn--secondary kb-btn--lg">
            <span>{retrieveLabel}</span>
          </a>
        </div>
        <p className="quote-start__note">Your details are only used to prepare your quote.</p>
      </form>
    </div>
  );
}
