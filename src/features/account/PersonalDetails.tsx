import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";
import type { PersonalDetails as Details } from "#/server/data/settings";

import { MOBILE_ERROR, mobileSchema } from "./settings-model";
import { updateMyPhoneFn } from "./settings";
import { SettingsTitle } from "./SettingsLayout";

// Personal details (6.3, decisions 3 and 4; Figma 01 182:3254, 02 182:3358). The mobile is the
// only field: name and email are locked, and the address changes on a policy (6.3b). Saving is
// optimistic: the new number shows at once and goes back if the server refuses.

const SAVE_FAILED = "We couldn't save your mobile number. Try again.";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "1991-06-14" → "14 June 1991" (a calendar date, so read as UTC) */
const longDate = (iso: string) => LONG_DATE.format(new Date(`${iso}T00:00:00Z`));

function addressOf(customer: NonNullable<Details["customer"]>): string {
  const lines = [customer.addressLine1, customer.addressLine2].filter(Boolean);
  return `${lines.join(", ")}, ${customer.town} ${customer.postcode}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="settings__row" role="group" aria-labelledby={id}>
      <span id={id} className="settings__row-label">
        {label}
      </span>
      <span className="settings__row-value">{children}</span>
    </div>
  );
}

export function PersonalDetails({ details }: { details: Details }) {
  const { customer } = details;
  const fullName = customer ? `${customer.firstName} ${customer.lastName}` : details.name;
  const [phone, setPhone] = useState(customer?.phone ?? null);
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  // A save in flight: Edit waits, so a second save can't be overwritten by the first's rollback
  const [pending, setPending] = useState(false);
  // Where focus goes once the form opens or closes: the field after a refusal, Edit after a save
  const [focus, setFocus] = useState<"field" | "edit" | null>(null);
  useEffect(() => {
    if (focus === "field") field.current?.focus();
    if (focus === "edit") edit.current?.focus();
    if (focus) setFocus(null);
  }, [focus, editing, pending]);
  // The form's state lives here: the form closes on Save, and a rollback reopens it as it was
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  function open() {
    setDraft(phone ?? "");
    setFieldError(undefined);
    setFailed(false);
    setEditing(true);
  }

  async function save() {
    const parsed = mobileSchema.safeParse(draft);
    if (!parsed.success) {
      setFieldError(MOBILE_ERROR);
      return false;
    }
    const previous = phone;
    // Optimistic: show it and close; put it back if the server says no
    setPhone(parsed.data);
    setEditing(false);
    setPending(true);
    const rollback = (error?: string) => {
      setPhone(previous);
      setFieldError(error);
      setFailed(!error);
      setEditing(true);
      setFocus("field");
    };
    try {
      const result = await updateMyPhoneFn({
        data: { input: { phone: draft }, idempotencyKey: crypto.randomUUID() },
      });
      if (result.ok) setFocus("edit");
      else rollback(result.error.fields?.phone);
    } catch {
      rollback();
    } finally {
      setPending(false);
    }
    return true;
  }

  return (
    <>
      <SettingsTitle>Personal details</SettingsTitle>
      {editing && customer ? (
        <form
          className="settings__form"
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save().then((sent) => {
              if (!sent) field.current?.focus();
            });
          }}
        >
          {failed ? (
            <Alert tone="danger" announce>
              {SAVE_FAILED}
            </Alert>
          ) : null}
          <Input
            label="Full name"
            value={fullName}
            readOnly
            className="settings__locked"
            hint="To change your legal name, call us. We'll need to update your policy too."
          />
          <Input
            label="Email address"
            value={details.email}
            readOnly
            className="settings__locked"
            hint="To change your email, contact us."
          />
          <Input
            ref={field}
            label="Mobile number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={draft}
            error={fieldError}
            onChange={(event) => {
              setDraft(event.target.value);
              setFieldError(undefined);
            }}
          />
          <div className="settings__form-actions">
            <Button type="submit">Save changes</Button>
            <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="settings__rows">
          <Row label="Full name">{fullName}</Row>
          {customer ? <Row label="Date of birth">{longDate(customer.dateOfBirth)}</Row> : null}
          <Row label="Email address">{details.email}</Row>
          {customer ? (
            <>
              <Row label="Mobile number">
                {phone ?? <span className="settings__muted">Not added</span>}
              </Row>
              <Row label="Home address">{addressOf(customer)}</Row>
              <div className="settings__actions">
                <Button
                  ref={edit}
                  variant="secondary"
                  iconLeft="pencil"
                  onClick={open}
                  disabled={pending}
                >
                  Edit details
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
