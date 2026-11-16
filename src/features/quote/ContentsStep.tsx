import { useRef, useState, type FormEvent } from "react";

import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { storedHomeAnswers, storedHomeErrors } from "./home-steps";
import { setHomeStepAnswers } from "./journey-store";
import { JourneyPage } from "./page-kit";
import {
  alarmOptions,
  contentsSchema,
  lockTypeOptions,
  windowLockOptions,
  type ContentsAnswers,
} from "./schemas/home-steps";
import {
  chosen,
  numberText,
  StepActions,
  StepHeading,
  type Errors,
  type StepProps,
} from "./step-kit";

// Contents and security (5.7, decision 5; screen 06, 222:6777, in 5.4b's frame). The price reads
// the contents value, the door lock, "any alarm" and the smoke alarms; valuables, window locks and
// the kind of alarm are stored too (decision 10).

export function ContentsStep({
  journey,
  today,
  revalidate,
  onBack,
  onDone,
  tabs,
  aside,
}: StepProps) {
  const stored = storedHomeAnswers(journey, "contents") as ContentsAnswers | undefined;
  const [form, setForm] = useState(() => ({
    contentsValuePounds: numberText(stored?.contentsValuePounds),
    valuablesPounds: numberText(stored?.valuablesPounds),
    lockType: stored?.lockType ?? "",
    windowLocks: stored?.windowLocks ?? "",
    alarm: stored?.alarm ?? "",
    smokeAlarm: stored?.smokeAlarm ?? false,
  }));
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedHomeErrors(journey, "contents", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(contentsSchema, {
      ...form,
      lockType: chosen(form.lockType),
      windowLocks: chosen(form.windowLocks),
      alarm: chosen(form.alarm),
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setHomeStepAnswers("contents", result.data);
    onDone();
  }

  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Home insurance / Your details"
          title="Your contents and home security"
          intro="Tell us what you’d need to replace and how your home is protected."
        />
      }
      tabs={tabs}
      aside={aside}
      asideLabel="Your home and help"
    >
      <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
        <section className="quote-panel" aria-labelledby="contents-heading">
          <h2 id="contents-heading" className="kb-h3 quote-panel__title">
            The things you keep at home
          </h2>
          <div className="quote-fields">
            <Input
              label="Total contents value"
              inputMode="numeric"
              prefix="£"
              hint="Cost to replace everything as new."
              value={form.contentsValuePounds}
              error={errors.contentsValuePounds}
              onChange={set("contentsValuePounds")}
            />
            <Input
              label="Valuables total"
              inputMode="numeric"
              prefix="£"
              hint="Included within your contents total."
              value={form.valuablesPounds}
              error={errors.valuablesPounds}
              onChange={set("valuablesPounds")}
            />
          </div>
          <p className="quote-panel__note">
            Include furniture, clothes, electronics and other belongings. Valuables include
            jewellery, watches and artwork.
          </p>
        </section>

        <section className="quote-panel" aria-labelledby="security-heading">
          <h2 id="security-heading" className="kb-h3 quote-panel__title">
            Keeping your home secure
          </h2>
          <div className="quote-fields">
            <Select
              label="Main external door lock"
              placeholder="Choose a lock"
              hint="Choose the closest match."
              options={lockTypeOptions}
              value={form.lockType}
              error={errors.lockType}
              onChange={set("lockType")}
            />
            <Select
              label="Window locks"
              placeholder="Choose"
              options={windowLockOptions}
              value={form.windowLocks}
              error={errors.windowLocks}
              onChange={set("windowLocks")}
            />
          </div>
          <Select
            label="Burglar alarm"
            placeholder="Choose"
            hint="If you don’t have an alarm, choose “No alarm”."
            options={alarmOptions}
            value={form.alarm}
            error={errors.alarm}
            onChange={set("alarm")}
          />
          <Checkbox
            label="Smoke alarms are fitted and working"
            checked={form.smokeAlarm}
            onChange={(e) => setForm((f) => ({ ...f, smokeAlarm: e.target.checked }))}
          />
        </section>

        <StepActions onBack={onBack} submit="Continue to past claims" />
      </form>
    </JourneyPage>
  );
}
