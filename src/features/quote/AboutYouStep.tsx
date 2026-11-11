import { useRef, useState, type FormEvent } from "react";

import { Icon } from "#/components/display/Icon";
import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { fuelLabel } from "./catalogue";
import { DateField, isoOf, partsOf, type DateParts } from "./DateField";
import { setStepAnswers } from "./journey-store";
import { OccupationField, type OccupationValue } from "./OccupationField";
import { aboutYouSchema, type AboutYou } from "./schemas/driver-steps";
import { chosen, StepActions, StepHeading, type Errors, type StepProps } from "./step-kit";
import { storedAnswers } from "./steps";

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

export function AboutYouStep({ journey, today, onBack, onDone }: StepProps) {
  const [form, setForm] = useState(() => initial(storedAnswers(journey, "about") as AboutYou));
  const [errors, setErrors] = useState<Errors>({});
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
    <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
      <StepHeading
        overline="Car · Your details · About you"
        title="Tell us about you"
        intro={
          car ? (
            <>
              We&rsquo;ll use this information to build your quote for the {car.year} {car.make}{" "}
              {car.model}.
            </>
          ) : null
        }
      />

      <div className="quote-details">
        {car ? (
          <section className="quote-aside quote-car" aria-label="Your car">
            <Icon name="car" size={24} />
            <p className="quote-car__name">
              {car.make} {car.model} {car.variant}
            </p>
            <p>
              {car.year} · {fuelLabel(car.fuelType)} · {car.doors} doors
            </p>
          </section>
        ) : null}

        <div className="quote-panel">
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
          <Input label="Address line 1" autoComplete="address-line1" {...text("addressLine1")} />
          <Input
            label="Address line 2"
            optional
            autoComplete="address-line2"
            {...text("addressLine2")}
          />
          <Input label="Town or city" autoComplete="address-level2" {...text("town")} />
          {/* The shell's "Your postcode … Change" line sits under every step */}
          <p className="quote-postcode">Home postcode: {journey.postcode}.</p>
        </div>
      </div>

      <StepActions onBack={onBack} submit="Continue to your licence" />
    </form>
  );
}
