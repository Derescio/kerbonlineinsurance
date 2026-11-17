import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Checkbox } from "#/components/forms/Checkbox";
import { FieldMessage } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, emptyDate, isoOf, partsOf, type DateParts } from "./DateField";
import { storedHomeAnswers, storedHomeErrors } from "./home-steps";
import { setHomeStepAnswers } from "./journey-store";
import { JourneyPage } from "./page-kit";
import {
  claimStatusOptions,
  homeClaimsSchema,
  homeClaimTypeOptions,
  type HomeClaims,
} from "./schemas/home-steps";
import {
  chosen,
  numberText,
  StepActions,
  StepHeading,
  YesNo,
  type Errors,
  type StepProps,
} from "./step-kit";

// Past claims (5.7, decision 6; screen 07, 222:6792, in 5.4b's frame): up to 5 claims, each stored
// as a prior_claims row (decision 10). The price reads how many; 3 or more is referred.

const MAX_CLAIMS = 5;

interface ClaimForm {
  id: string;
  date: DateParts;
  type: string;
  amount: string;
  status: string;
}

const newClaim = (): ClaimForm => ({
  id: crypto.randomUUID(),
  date: emptyDate,
  type: "",
  amount: "",
  status: "",
});

export function HomeClaimsStep({
  journey,
  today,
  revalidate,
  onBack,
  onDone,
  tabs,
  aside,
}: StepProps) {
  const stored = storedHomeAnswers(journey, "claims") as HomeClaims | undefined;
  const [any, setAny] = useState<boolean | undefined>(stored?.any);
  const [claims, setClaims] = useState<ClaimForm[]>(
    () =>
      stored?.claims.map((c) => ({
        id: c.id,
        date: partsOf(c.date),
        type: c.type,
        amount: numberText(c.amountPounds),
        status: c.status,
      })) ?? [],
  );
  const [confirmed, setConfirmed] = useState(stored?.confirmed ?? false);
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedHomeErrors(journey, "claims", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  function answer(yes: boolean) {
    setAny(yes);
    setClaims(yes ? (current) => (current.length ? current : [newClaim()]) : []);
  }

  function update(id: string, change: Partial<ClaimForm>) {
    setClaims((current) => current.map((c) => (c.id === id ? { ...c, ...change } : c)));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(homeClaimsSchema(today), {
      any,
      claims: claims.map((c) => ({
        id: c.id,
        date: isoOf(c.date),
        type: chosen(c.type),
        amountPounds: c.amount,
        status: chosen(c.status),
      })),
      confirmed,
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setHomeStepAnswers("claims", result.data);
    onDone();
  }

  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Home insurance / Your details"
          title="Any home claims in the last 5 years?"
          intro="Include buildings or contents claims made by you or anyone who lives with you, at this or a previous address."
        />
      }
      tabs={tabs}
      aside={aside}
      asideLabel="Your home and help"
    >
      <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
        <section className="quote-panel" aria-label="Home claims">
          <YesNo
            name="home-claims-any"
            legend="Have you or your household made a claim?"
            value={any}
            error={errors.any ?? errors.claims}
            onChange={answer}
          />
        </section>
        {claims.map((claim, i) => {
          const err = (field: string) => errors[`claims.${i}.${field}`];
          return (
            <section
              key={claim.id}
              className="quote-panel quote-repeat"
              aria-labelledby={`claim-${claim.id}`}
            >
              <div className="quote-repeat__head">
                <h2 id={`claim-${claim.id}`} className="kb-h3">
                  Claim {i + 1}
                </h2>
                <button
                  type="button"
                  className="quote-link"
                  onClick={() => setClaims((c) => c.filter((x) => x.id !== claim.id))}
                >
                  Remove<span className="kb-sr-only"> claim {i + 1}</span>
                </button>
              </div>
              <div className="quote-fields">
                <DateField
                  legend="Date of incident"
                  hint="For example, 12 3 2024"
                  value={claim.date}
                  error={err("date")}
                  onChange={(date) => update(claim.id, { date })}
                />
                <Select
                  label="Type of claim"
                  placeholder="Choose a type"
                  options={homeClaimTypeOptions}
                  value={claim.type}
                  error={err("type")}
                  onChange={(e) => update(claim.id, { type: e.target.value })}
                />
                <Input
                  label="Total claim amount"
                  inputMode="numeric"
                  prefix="£"
                  hint="Amount paid or estimated."
                  value={claim.amount}
                  error={err("amountPounds")}
                  onChange={(e) => update(claim.id, { amount: e.target.value })}
                />
                <Select
                  label="Claim status"
                  placeholder="Choose a status"
                  options={claimStatusOptions}
                  value={claim.status}
                  error={err("status")}
                  onChange={(e) => update(claim.id, { status: e.target.value })}
                />
              </div>
            </section>
          );
        })}
        {any && claims.length < MAX_CLAIMS ? (
          <Button
            type="button"
            variant="secondary"
            className="quote-add"
            onClick={() => setClaims((current) => [...current, newClaim()])}
          >
            Add another claim
          </Button>
        ) : null}

        <section className="quote-confirm" aria-labelledby="ready-heading">
          <h2 id="ready-heading" className="kb-h4">
            Ready to get your quote?
          </h2>
          <p>
            Check your property, contents, security and claims details are complete and accurate.
            Incorrect details could affect your cover or a future claim.
          </p>
          <Checkbox
            label="I confirm these details are complete and accurate."
            checked={confirmed}
            aria-invalid={errors.confirmed ? true : undefined}
            aria-describedby={errors.confirmed ? "home-claims-confirmed-error" : undefined}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <FieldMessage id="home-claims-confirmed" error={errors.confirmed} />
        </section>

        <StepActions onBack={onBack} submit="Get my home quote" />
      </form>
    </JourneyPage>
  );
}
