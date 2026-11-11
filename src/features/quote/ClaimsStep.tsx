import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Checkbox } from "#/components/forms/Checkbox";
import { FieldMessage } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { DateField, emptyDate, isoOf, partsOf, type DateParts } from "./DateField";
import { setStepAnswers } from "./journey-store";
import {
  claimsSchema,
  faultOptions,
  incidentTypeOptions,
  type Claims,
} from "./schemas/driver-steps";
import {
  chosen,
  numberText,
  StepActions,
  StepHeading,
  YesNo,
  type Errors,
  type StepProps,
} from "./step-kit";
import { storedAnswers, storedErrors } from "./steps";

// Claims (5.3, call 9): screen 12 (226:684) without the convictions card (decision 3). The count
// becomes drivers.past_claims in 5.6; the details stay in the tab (decision 4).

const MAX_INCIDENTS = 10;

interface IncidentForm {
  id: string;
  date: DateParts;
  type: string;
  fault: string;
  cost: string;
}

const newIncident = (): IncidentForm => ({
  id: crypto.randomUUID(),
  date: emptyDate,
  type: "",
  fault: "",
  cost: "",
});

export function ClaimsStep({ journey, today, revalidate, onBack, onDone }: StepProps) {
  const stored = storedAnswers(journey, "claims") as Claims | undefined;
  const [any, setAny] = useState<boolean | undefined>(stored?.any);
  const [incidents, setIncidents] = useState<IncidentForm[]>(
    () =>
      stored?.incidents.map((i) => ({
        id: i.id,
        date: partsOf(i.date),
        type: i.type,
        fault: i.fault,
        cost: numberText(i.costPounds),
      })) ?? [],
  );
  const [confirmed, setConfirmed] = useState(stored?.confirmed ?? false);
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedErrors(journey, "claims", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  function answer(yes: boolean) {
    setAny(yes);
    setIncidents(yes ? (current) => (current.length ? current : [newIncident()]) : []);
  }

  function update(id: string, change: Partial<IncidentForm>) {
    setIncidents((current) => current.map((i) => (i.id === id ? { ...i, ...change } : i)));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(claimsSchema(today), {
      any,
      incidents: incidents.map((i) => ({
        id: i.id,
        date: isoOf(i.date),
        type: chosen(i.type),
        fault: chosen(i.fault),
        costPounds: i.cost,
      })),
      confirmed,
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setStepAnswers("claims", result.data);
    onDone();
  }

  return (
    <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
      <StepHeading
        overline="Car · Your details · History"
        title="Claims"
        intro="Tell us about the main driver’s history. Add each incident separately, including incidents at a previous insurer."
      />

      <section className="quote-panel" aria-label="Accidents, claims or losses">
        <YesNo
          name="claims-any"
          legend="Any accidents, claims or losses in the last 5 years?"
          hint="Include incidents even if you didn’t claim, and whether or not you were at fault."
          value={any}
          error={errors.any ?? errors.incidents}
          onChange={answer}
        />
        {incidents.map((incident, i) => {
          const err = (field: string) => errors[`incidents.${i}.${field}`];
          return (
            <div key={incident.id} className="quote-repeat">
              <h2 className="kb-sr-only">Incident {i + 1}</h2>
              <div className="quote-fields">
                <DateField
                  legend="Date of incident"
                  value={incident.date}
                  error={err("date")}
                  onChange={(date) => update(incident.id, { date })}
                />
                <Select
                  label="Type of incident"
                  placeholder="Choose a type"
                  options={incidentTypeOptions}
                  value={incident.type}
                  error={err("type")}
                  onChange={(e) => update(incident.id, { type: e.target.value })}
                />
                <Select
                  label="Responsibility"
                  placeholder="Choose who was at fault"
                  options={faultOptions}
                  value={incident.fault}
                  error={err("fault")}
                  onChange={(e) => update(incident.id, { fault: e.target.value })}
                />
                <Input
                  label="Total claim cost"
                  inputMode="numeric"
                  prefix="£"
                  value={incident.cost}
                  error={err("costPounds")}
                  onChange={(e) => update(incident.id, { cost: e.target.value })}
                />
              </div>
              {incidents.length > 1 ? (
                <button
                  type="button"
                  className="quote-link"
                  onClick={() => setIncidents((c) => c.filter((x) => x.id !== incident.id))}
                >
                  Remove<span className="kb-sr-only"> incident {i + 1}</span>
                </button>
              ) : null}
            </div>
          );
        })}
        {any && incidents.length < MAX_INCIDENTS ? (
          <Button
            type="button"
            variant="secondary"
            className="quote-add"
            onClick={() => setIncidents((current) => [...current, newIncident()])}
          >
            Add another incident
          </Button>
        ) : null}
      </section>

      <div className="quote-confirm">
        <Checkbox
          label="I confirm my driving history is complete and accurate."
          checked={confirmed}
          aria-invalid={errors.confirmed ? true : undefined}
          aria-describedby={errors.confirmed ? "claims-confirmed-error" : undefined}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <FieldMessage id="claims-confirmed" error={errors.confirmed} />
      </div>

      <StepActions onBack={onBack} submit="Continue to named drivers" />
    </form>
  );
}
