import { useRef, useState, type FormEvent } from "react";

import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, isoOf, partsOf, type DateParts } from "./DateField";
import { storedHomeAnswers, storedHomeErrors } from "./home-steps";
import { prefillAbout } from "./bundle";
import { readJourney, setHomeStepAnswers } from "./journey-store";
import { JourneyPage } from "./page-kit";
import { homeAboutSchema, type HomeAbout } from "./schemas/home-steps";
import { StepActions, StepHeading, type Errors, type StepProps } from "./step-kit";

// About you on the home journey (5.7, decision 3): the policyholder's name and date of birth, so a
// first-time buyer's customer row can be made. Not drawn in Figma; it takes car's About you fields.

interface Form {
  firstName: string;
  lastName: string;
  dateOfBirth: DateParts;
}

export function HomeAboutStep({
  journey,
  today,
  revalidate,
  onBack,
  onDone,
  tabs,
  aside,
}: StepProps) {
  // Empty, it starts from car's main driver when a car quote is in the tab (5.7b, decision 3)
  const stored =
    (storedHomeAnswers(journey, "about") as HomeAbout | undefined) ??
    prefillAbout(readJourney("car"));
  const [form, setForm] = useState<Form>(() => ({
    firstName: stored?.firstName ?? "",
    lastName: stored?.lastName ?? "",
    dateOfBirth: partsOf(stored?.dateOfBirth),
  }));
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedHomeErrors(journey, "about", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(homeAboutSchema(today), {
      ...form,
      dateOfBirth: isoOf(form.dateOfBirth),
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setHomeStepAnswers("about", result.data);
    onDone();
  }

  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Home insurance / Your details"
          title="Tell us about you"
          intro="We’ll use this information to build your home quote."
        />
      }
      tabs={tabs}
      aside={aside}
      asideLabel="Your home and help"
    >
      <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
        <section className="quote-panel" aria-labelledby="home-about-heading">
          <h2 id="home-about-heading" className="kb-h3 quote-panel__title">
            About you
          </h2>
          <div className="quote-fields">
            <Input
              label="First name"
              autoComplete="given-name"
              value={form.firstName}
              error={errors.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <Input
              label="Last name"
              autoComplete="family-name"
              value={form.lastName}
              error={errors.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <DateField
            legend="Date of birth"
            birthday
            value={form.dateOfBirth}
            error={errors.dateOfBirth}
            onChange={(dateOfBirth) => setForm((f) => ({ ...f, dateOfBirth }))}
          />
        </section>
        <StepActions onBack={onBack} submit="Continue to property" />
      </form>
    </JourneyPage>
  );
}
