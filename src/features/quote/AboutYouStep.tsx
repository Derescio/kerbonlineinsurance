import { useRef, useState, type FormEvent } from "react";

import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, isoOf, partsOf, type DateParts } from "./DateField";
import { setStepAnswers } from "./journey-store";
import { OccupationField, type OccupationValue } from "./OccupationField";
import { aboutYouSchema, type AboutYou } from "./schemas/driver-steps";
import { chosen, StepActions, StepHeading, type Errors, type StepProps } from "./step-kit";
import { aboutIntro } from "./intros";
import { JourneyPage } from "./page-kit";
import { storedAnswers, storedErrors } from "./steps";

// About you (5.3, call 7): the original journey's "Tell us about you and your car" (157:10429). The
// car is already confirmed, so the title is "Tell us about you" (plan P1); overnight parking moves
// to the licence step, and the confirmation box to the claims step.

interface Form extends OccupationValue {
  firstName: string;
  lastName: string;
  dateOfBirth: DateParts;
  addressLine1: string;
  addressLine2: string;
  town: string;
}

function initial(stored: AboutYou | undefined): Form {
  return {
    firstName: stored?.firstName ?? "",
    lastName: stored?.lastName ?? "",
    dateOfBirth: partsOf(stored?.dateOfBirth),
    status: stored?.status ?? "",
    occupation: stored?.occupation ?? "",
    addressLine1: stored?.addressLine1 ?? "",
    addressLine2: stored?.addressLine2 ?? "",
    town: stored?.town ?? "",
  };
}

export function AboutYouStep({
  journey,
  today,
  revalidate,
  onBack,
  onDone,
  tabs,
  aside,
}: StepProps) {
  const [form, setForm] = useState(() => initial(storedAnswers(journey, "about") as AboutYou));
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedErrors(journey, "about", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const car = journey.vehicle;

  const set =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]) =>
      setForm((current) => ({ ...current, [key]: value }));
  const text = (key: "firstName" | "lastName" | "addressLine1" | "addressLine2" | "town") => ({
    value: form[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(aboutYouSchema(today), {
      ...form,
      dateOfBirth: isoOf(form.dateOfBirth),
      status: chosen(form.status),
      occupation: form.occupation || undefined,
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setStepAnswers("about", result.data);
    onDone();
  }

  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Car insurance / Your details"
          title="Tell us about you"
          intro={aboutIntro(car)}
        />
      }
      tabs={tabs}
      aside={aside}
    >
      <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
        <section className="quote-panel" aria-labelledby="about-heading">
          <h2 id="about-heading" className="kb-h3 quote-panel__title">
            About you
          </h2>
          <div className="quote-fields">
            <Input label="First name" autoComplete="given-name" {...text("firstName")} />
            <Input label="Last name" autoComplete="family-name" {...text("lastName")} />
          </div>
          <DateField
            legend="Date of birth"
            birthday
            value={form.dateOfBirth}
            error={errors.dateOfBirth}
            onChange={set("dateOfBirth")}
          />
          <OccupationField
            value={form}
            errors={{ status: errors.status, occupation: errors.occupation }}
            onChange={(value) => setForm((current) => ({ ...current, ...value }))}
          />
        </section>

        <section className="quote-panel" aria-labelledby="address-heading">
          <h2 id="address-heading" className="kb-h3 quote-panel__title">
            Home address
          </h2>
          <Input label="Address line 1" autoComplete="address-line1" {...text("addressLine1")} />
          <Input
            label="Address line 2"
            optional
            autoComplete="address-line2"
            {...text("addressLine2")}
          />
          <Input label="Town or city" autoComplete="address-level2" {...text("town")} />
          <p className="quote-postcode">Home postcode: {journey.postcode}</p>
        </section>

        <StepActions onBack={onBack} submit="Continue to your licence" />
      </form>
    </JourneyPage>
  );
}
