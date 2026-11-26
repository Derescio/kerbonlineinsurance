import { useState } from "react";

import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import {
  alarmOptions,
  homeErrors,
  lockTypeOptions,
  windowLockOptions,
} from "#/features/quote/schemas/home-steps";
import type { PolicyDetail } from "#/server/data/policies";

import { ChangeDialog } from "./ChangeDialog";

// A home policy's own changes (6.3c, decisions 5 and 6; Figma 282:4145 Update contents, 282:4201
// Update security), with the home journey's labels, options and limits. Each opens on what's
// stored; an answer never given opens empty and must be answered before there's a price.

interface DialogProps {
  policy: PolicyDetail;
  onClose: () => void;
  onApplied: () => void;
}

/** Whole pounds typed in a box, commas allowed; null when it isn't one */
function pounds(text: string): number | null {
  const digits = text.replace(/,/g, "").trim();
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

const shown = (pence: number | null) =>
  pence === null ? "" : (pence / 100).toLocaleString("en-GB");

export function UpdateContentsDialog({ policy, onClose, onApplied }: DialogProps) {
  const home = policy.home!;
  const [contentsText, setContents] = useState(shown(home.contentsValuePence));
  const [valuablesText, setValuables] = useState(shown(home.valuablesPence));

  const contents = pounds(contentsText);
  const valuables = pounds(valuablesText);
  const contentsError =
    contentsText.trim() && (contents === null || contents < 5_000 || contents > 500_000)
      ? homeErrors.contentsValue
      : undefined;
  const valuablesError =
    valuablesText.trim() && valuables === null
      ? homeErrors.valuables
      : contents !== null && valuables !== null && valuables > contents
        ? homeErrors.valuablesOverContents
        : undefined;
  const change =
    contents !== null && valuables !== null && !contentsError && !valuablesError
      ? {
          kind: "home_contents",
          contentsValuePence: contents * 100,
          valuablesPence: valuables * 100,
        }
      : null;

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Update contents"
      reference={policy.reference}
      change={change}
    >
      <Input
        label="Total contents value"
        inputMode="numeric"
        prefix="£"
        hint="Cost to replace everything as new."
        value={contentsText}
        error={contentsError}
        onChange={(e) => setContents(e.target.value)}
      />
      <Input
        label="Valuables total"
        inputMode="numeric"
        prefix="£"
        hint="Included within your contents total."
        value={valuablesText}
        error={valuablesError}
        onChange={(e) => setValuables(e.target.value)}
      />
      <p className="pc-note">
        Include furniture, clothes, electronics and other belongings. Valuables include jewellery,
        watches and artwork.
      </p>
    </ChangeDialog>
  );
}

export function UpdateSecurityDialog({ policy, onClose, onApplied }: DialogProps) {
  const home = policy.home!;
  const [lockType, setLockType] = useState(home.lockType);
  const [windowLocks, setWindowLocks] = useState(home.windowLocks ?? "");
  const [alarmType, setAlarmType] = useState(home.alarmType ?? "");
  const [hasSmokeAlarm, setSmokeAlarm] = useState(home.hasSmokeAlarm);

  const change =
    lockType && windowLocks && alarmType
      ? { kind: "home_security", lockType, windowLocks, alarmType, hasSmokeAlarm }
      : null;

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Update security"
      reference={policy.reference}
      change={change}
    >
      <Select
        label="Main external door lock"
        placeholder="Choose a lock"
        hint="Choose the closest match."
        options={lockTypeOptions}
        value={lockType}
        onChange={(e) => setLockType(e.target.value)}
      />
      <Select
        label="Window locks"
        placeholder="Choose"
        options={windowLockOptions}
        value={windowLocks}
        onChange={(e) => setWindowLocks(e.target.value)}
      />
      <Select
        label="Burglar alarm"
        placeholder="Choose"
        hint="If you don’t have an alarm, choose “No alarm”."
        options={alarmOptions}
        value={alarmType}
        onChange={(e) => setAlarmType(e.target.value)}
      />
      <Checkbox
        label="Smoke alarms are fitted and working"
        checked={hasSmokeAlarm}
        onChange={(e) => setSmokeAlarm(e.target.checked)}
      />
    </ChangeDialog>
  );
}
