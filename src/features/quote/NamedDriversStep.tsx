import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, emptyDate, isoOf, partsOf, type DateParts } from "./DateField";
import { setStepAnswers } from "./journey-store";
import { OccupationField, type OccupationValue } from "./OccupationField";
import {
  claimsCountOptions,
  licenceOptions,
  namedDriversSchema,
  relationshipOptions,
  type NamedDrivers,
} from "./schemas/driver-steps";
import { chosen, StepActions, StepHeading, YesNo, type Errors, type StepProps } from "./step-kit";
import { storedAnswers, storedErrors } from "./steps";

// Named drivers (5.3, call 12): screen 12a (235:1638) without the convictions question
// (decision 3). Up to 4; a named driver's no-claims years are stored as 0 in 5.6, and the
// relationship stays in the tab.

const MAX_DRIVERS = 4;

interface DriverForm extends OccupationValue {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: DateParts;
  relationship: string;
  licenceType: string;
  licenceDate: DateParts;
  anyClaims: boolean | undefined;
  pastClaims: string;
}

const newDriver = (): DriverForm => ({
  id: crypto.randomUUID(),
  firstName: "",
  lastName: "",
  dateOfBirth: emptyDate,
  relationship: "",
  status: "",
  occupation: "",
  licenceType: "",
  licenceDate: emptyDate,
  anyClaims: undefined,
  pastClaims: "",
});

const headingId = (id: string) => `named-driver-${id}`;

export function NamedDriversStep({ journey, today, revalidate, onBack, onDone }: StepProps) {
  const stored = storedAnswers(journey, "drivers") as NamedDrivers | undefined;
  const [any, setAny] = useState<boolean | undefined>(stored?.any);
  const [drivers, setDrivers] = useState<DriverForm[]>(
    () =>
      stored?.drivers.map((d) => ({
        ...d,
        dateOfBirth: partsOf(d.dateOfBirth),
        licenceDate: partsOf(d.licenceDate),
        pastClaims: d.anyClaims ? String(d.pastClaims) : "",
      })) ?? [],
  );
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedErrors(journey, "drivers", today) : {},
  );
  // After "Remove driver": the heading (or the No radio) that should get focus
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const car = journey.vehicle;

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function answer(yes: boolean) {
    setAny(yes);
    setDrivers(yes ? (current) => (current.length ? current : [newDriver()]) : []);
  }

  function update(id: string, change: Partial<DriverForm>) {
    setDrivers((current) => current.map((d) => (d.id === id ? { ...d, ...change } : d)));
  }

  function remove(index: number) {
    const rest = drivers.filter((_, i) => i !== index);
    setDrivers(rest);
    setErrors({});
    if (rest.length === 0) {
      setAny(false);
      setFocusTarget("drivers-any-no");
    } else {
      setFocusTarget(headingId(rest[Math.min(index, rest.length - 1)]!.id));
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(namedDriversSchema(today), {
      any,
      drivers: drivers.map((d) => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: isoOf(d.dateOfBirth),
        relationship: chosen(d.relationship),
        status: chosen(d.status),
        occupation: d.occupation || undefined,
        licenceType: chosen(d.licenceType),
        licenceDate: isoOf(d.licenceDate),
        anyClaims: d.anyClaims,
        pastClaims: d.anyClaims === false ? 0 : chosen(d.pastClaims),
      })),
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setStepAnswers("drivers", result.data);
    onDone();
  }

  return (
    <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
      <StepHeading
        overline="Car · Your details · Named drivers"
        title="Who else will drive your car?"
        intro={
          car ? (
            <>
              Add anyone else who needs to drive the {car.make} {car.model}. You&rsquo;ll remain the
              main driver.
            </>
          ) : null
        }
      />

      <section className="quote-panel" aria-label="Named drivers">
        <YesNo
          name="drivers-any"
          legend="Would you like to add a named driver?"
          hint="Only people listed on your policy will be covered to drive your car."
          value={any}
          error={errors.any ?? errors.drivers}
          onChange={answer}
        />
      </section>

      {drivers.map((driver, i) => {
        const err = (field: string) => errors[`drivers.${i}.${field}`];
        const name = driver.firstName.trim();
        const text = (key: "firstName" | "lastName") => ({
          value: driver[key],
          error: err(key),
          onChange: (e: { target: { value: string } }) =>
            update(driver.id, { [key]: e.target.value }),
        });
        return (
          <div key={driver.id} className="quote-form">
            <section className="quote-panel" aria-labelledby={headingId(driver.id)}>
              <div className="quote-panel__head">
                <h2 id={headingId(driver.id)} className="kb-h3 quote-panel__title" tabIndex={-1}>
                  Named driver {i + 1}
                </h2>
                <button type="button" className="quote-link" onClick={() => remove(i)}>
                  Remove driver<span className="kb-sr-only"> {i + 1}</span>
                </button>
              </div>
              <div className="quote-fields">
                <Input label="First name" {...text("firstName")} />
                <Input label="Last name" {...text("lastName")} />
              </div>
              <p className="quote-note">Use their name as it appears on their driving licence.</p>
              <div className="quote-fields">
                <DateField
                  legend="Date of birth"
                  value={driver.dateOfBirth}
                  error={err("dateOfBirth")}
                  onChange={(dateOfBirth) => update(driver.id, { dateOfBirth })}
                />
                <Select
                  label="Relationship to you"
                  placeholder="Choose a relationship"
                  options={relationshipOptions}
                  value={driver.relationship}
                  error={err("relationship")}
                  onChange={(e) => update(driver.id, { relationship: e.target.value })}
                />
              </div>
              <OccupationField
                value={driver}
                errors={{ status: err("status"), occupation: err("occupation") }}
                onChange={(value) => update(driver.id, value)}
              />
            </section>

            <section className="quote-panel" aria-labelledby={`${headingId(driver.id)}-history`}>
              <h3 id={`${headingId(driver.id)}-history`} className="kb-h3 quote-panel__title">
                {name
                  ? `${name}’s licence and driving history`
                  : "Their licence and driving history"}
              </h3>
              <div className="quote-fields">
                <Select
                  label="Licence type"
                  placeholder="Choose a licence type"
                  options={licenceOptions}
                  value={driver.licenceType}
                  error={err("licenceType")}
                  onChange={(e) => update(driver.id, { licenceType: e.target.value })}
                />
                <DateField
                  legend="Date full licence obtained"
                  value={driver.licenceDate}
                  error={err("licenceDate")}
                  onChange={(licenceDate) => update(driver.id, { licenceDate })}
                />
              </div>
              <YesNo
                name={`driver-${driver.id}-claims`}
                legend="Any accidents, claims or losses in the last 5 years?"
                hint="Include incidents even if they didn’t claim, or weren’t at fault."
                value={driver.anyClaims}
                error={err("anyClaims")}
                onChange={(anyClaims) =>
                  update(driver.id, { anyClaims, ...(!anyClaims && { pastClaims: "" }) })
                }
              />
              {driver.anyClaims ? (
                <Select
                  label="How many?"
                  placeholder="Choose how many"
                  options={claimsCountOptions}
                  value={driver.pastClaims}
                  error={err("pastClaims")}
                  onChange={(e) => update(driver.id, { pastClaims: e.target.value })}
                />
              ) : null}
            </section>
          </div>
        );
      })}

      {any && drivers.length < MAX_DRIVERS ? (
        <Button
          type="button"
          variant="secondary"
          className="quote-add"
          onClick={() => setDrivers((current) => [...current, newDriver()])}
        >
          Add another driver
        </Button>
      ) : null}

      <StepActions onBack={onBack} submit="Get my car quote" />
    </form>
  );
}
