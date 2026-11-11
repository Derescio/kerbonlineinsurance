import { useRef, useState, type FormEvent } from "react";

import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, isoOf, partsOf, type DateParts } from "./DateField";
import { setStepAnswers } from "./journey-store";
import {
  licenceOptions,
  licenceSchema,
  noClaimsOptions,
  overnightOptions,
  usageOptions,
  type LicenceAndUsage,
} from "./schemas/driver-steps";
import {
  chosen,
  numberText,
  StepActions,
  StepHeading,
  type Errors,
  type StepProps,
} from "./step-kit";
import { storedAnswers } from "./steps";

// Licence and driving (5.3, call 8): screen 11 (226:669), plus "Current mileage", which
// vehicles.current_mileage needs and nothing else asks for.

interface Form {
  licenceType: string;
  licenceDate: DateParts;
  noClaimsYears: string;
  annualMileage: string;
  currentMileage: string;
  usage: string;
  overnight: string;
}

function initial(stored: LicenceAndUsage | undefined): Form {
  return {
    licenceType: stored?.licenceType ?? "",
    licenceDate: partsOf(stored?.licenceDate),
    noClaimsYears: numberText(stored?.noClaimsYears),
    annualMileage: numberText(stored?.annualMileage),
    currentMileage: numberText(stored?.currentMileage),
    usage: stored?.usage ?? "",
    overnight: stored?.overnight ?? "",
  };
}

export function LicenceStep({ journey, today, onBack, onDone }: StepProps) {
  const [form, setForm] = useState(() =>
    initial(storedAnswers(journey, "driving") as LicenceAndUsage | undefined),
  );
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const driver = journey.mainDriver;
  const car = journey.vehicle;

  const set =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]) =>
      setForm((current) => ({ ...current, [key]: value }));
  const choice = (key: Exclude<keyof Form, "licenceDate">) => ({
    value: form[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(licenceSchema(today, driver?.dateOfBirth), {
      licenceType: chosen(form.licenceType),
      licenceDate: isoOf(form.licenceDate),
      noClaimsYears: chosen(form.noClaimsYears),
      annualMileage: form.annualMileage,
      currentMileage: form.currentMileage,
      usage: chosen(form.usage),
      overnight: chosen(form.overnight),
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setStepAnswers("driving", result.data);
    onDone();
  }

  return (
    <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
      <StepHeading
        overline="Car · Your details · Driving"
        title="Your licence and driving"
        intro={
          driver && car
            ? `A few more details about ${driver.firstName} ${driver.lastName} and how the ${car.make} ${car.model} is used.`
            : null
        }
      />

      <section className="quote-panel" aria-labelledby="licence-heading">
        <h2 id="licence-heading" className="kb-h3 quote-panel__title">
          Your driving licence
        </h2>
        <div className="quote-fields">
          <Select
            label="Licence type"
            placeholder="Choose a licence type"
            options={licenceOptions}
            {...choice("licenceType")}
          />
          <DateField
            legend="Date full licence obtained"
            hint="Use the date you passed your test."
            value={form.licenceDate}
            error={errors.licenceDate}
            onChange={set("licenceDate")}
          />
        </div>
        <Select
          label="Years of no-claims discount"
          hint="Use the number on your latest renewal notice. We may ask for proof."
          placeholder="Choose the years"
          options={noClaimsOptions}
          {...choice("noClaimsYears")}
        />
      </section>

      <section className="quote-panel" aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="kb-h3 quote-panel__title">
          How you use your car
        </h2>
        <div className="quote-fields">
          <Input
            label="Annual mileage"
            inputMode="numeric"
            suffix="miles"
            hint="Estimated miles over the next 12 months."
            {...choice("annualMileage")}
          />
          <Input
            label="Current mileage"
            inputMode="numeric"
            suffix="miles"
            hint="As shown on the dashboard."
            {...choice("currentMileage")}
          />
        </div>
        <Select
          label="Use of the car"
          placeholder="Choose how the car is used"
          options={usageOptions}
          {...choice("usage")}
        />
        <p className="quote-note">
          Commuting includes travelling to a regular place of work. Choose business use if you drive
          between work locations. Delivery or hire-and-reward use needs different cover.
        </p>
        <Select
          label="Where is the car kept overnight?"
          placeholder="Choose a place"
          options={overnightOptions}
          {...choice("overnight")}
        />
      </section>

      <StepActions onBack={onBack} submit="Continue to driving history" />
    </form>
  );
}
