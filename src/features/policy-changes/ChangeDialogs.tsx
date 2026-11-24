import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { CoverageGroup } from "#/components/insurance/CoverageGroup";
import { addonCopy, VOLUNTARY_EXCESS_PENCE } from "#/features/quote/cover";
import { DateField, emptyDate, isoOf, type DateParts } from "#/features/quote/DateField";
import type { DemoAddress } from "#/features/quote/demo-addresses";
import { tierName } from "#/features/quote/labels";
import { OccupationField, type OccupationValue } from "#/features/quote/OccupationField";
import {
  licenceOptions,
  overnightOptions,
  relationshipOptions,
} from "#/features/quote/schemas/driver-steps";
import { findAddresses } from "#/features/quote/server";
import { formatPounds } from "#/features/rating/money";
import type { PolicyDetail } from "#/server/data/policies";
import { coverLevels, type CoverLevel } from "#/server/db/schema/values";

import { ChangeDialog } from "./ChangeDialog";
import type { OvernightLocation } from "./request";

// The "Make a change" dialogs (6.3b; Figma 183:3955 Add a driver, 183:4072 Change address,
// 183:4168 Change cover) and Remove driver, which isn't drawn and follows Add a driver's frame.
// Each builds its change once the form is whole; ChangeDialog prices and confirms it.

export const CLAIMS_ONLINE = "We can't add a driver with recent claims or convictions online.";

export type OpenDialog =
  | { kind: "driver_added" }
  | { kind: "driver_removed"; driverId: string; name: string }
  | { kind: "address" }
  | { kind: "cover" };

interface DialogProps {
  policy: PolicyDetail;
  onClose: () => void;
  onApplied: () => void;
}

export function ChangeDialogs({ dialog, ...props }: DialogProps & { dialog: OpenDialog | null }) {
  // Each dialog mounts fresh, so its form starts empty
  switch (dialog?.kind) {
    case "driver_added":
      return <AddDriverDialog {...props} />;
    case "driver_removed":
      return <RemoveDriverDialog {...props} driverId={dialog.driverId} name={dialog.name} />;
    case "address":
      return <ChangeAddressDialog {...props} />;
    case "cover":
      return <ChangeCoverDialog {...props} />;
    default:
      return null;
  }
}

function AddDriverDialog({ policy, onClose, onApplied }: DialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState<DateParts>(emptyDate);
  const [relationship, setRelationship] = useState("");
  const [licenceType, setLicenceType] = useState("");
  const [licenceDate, setLicenceDate] = useState<DateParts>(emptyDate);
  const [job, setJob] = useState<OccupationValue>({ status: "", occupation: "" });
  const [noClaims, setNoClaims] = useState(true);

  const whole =
    firstName.trim() &&
    lastName.trim() &&
    isoOf(dateOfBirth) &&
    relationship &&
    licenceType &&
    isoOf(licenceDate) &&
    job.status &&
    job.occupation;
  const change =
    whole && noClaims
      ? {
          kind: "driver_added",
          driver: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            dateOfBirth: isoOf(dateOfBirth),
            relationship,
            status: job.status,
            occupation: job.occupation,
            licenceType,
            licenceDate: isoOf(licenceDate),
            noClaimsConfirmed: true,
          },
        }
      : null;

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Add a driver"
      reference={policy.reference}
      change={change}
    >
      <div className="pc-row">
        <Input
          label="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <DateField legend="Date of birth" value={dateOfBirth} onChange={setDateOfBirth} />
      <Select
        label="Relationship to you"
        placeholder="Choose a relationship"
        options={relationshipOptions}
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
      />
      <Select
        label="Licence"
        placeholder="Choose a licence"
        options={licenceOptions.filter((o) => o.value !== "provisional")}
        value={licenceType}
        onChange={(e) => setLicenceType(e.target.value)}
      />
      <DateField legend="Full licence since" value={licenceDate} onChange={setLicenceDate} />
      <OccupationField value={job} onChange={setJob} errors={{}} />
      <Checkbox
        label="They've had no claims or convictions in the last 5 years"
        checked={noClaims}
        onChange={(e) => setNoClaims(e.target.checked)}
      />
      {!noClaims ? (
        <Alert tone="warning" announce>
          <p>{CLAIMS_ONLINE}</p>
        </Alert>
      ) : null}
    </ChangeDialog>
  );
}

function RemoveDriverDialog({
  policy,
  onClose,
  onApplied,
  driverId,
  name,
}: DialogProps & { driverId: string; name: string }) {
  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title={`Remove ${name} from your policy?`}
      confirmLabel="Remove driver"
      danger
      reference={policy.reference}
      change={{ kind: "driver_removed", driverId }}
    />
  );
}

function ChangeAddressDialog({ policy, onClose, onApplied }: DialogProps) {
  const [postcode, setPostcode] = useState("");
  const [found, setFound] = useState<{ postcode: string; addresses: DemoAddress[] } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [addressId, setAddressId] = useState("");
  const [overnight, setOvernight] = useState("");

  async function lookUp() {
    setLooking(true);
    setLookupError(null);
    setAddressId("");
    try {
      const answer = await findAddresses({ data: { postcode } });
      if (answer.result !== "found" || answer.addresses.length === 0) {
        setFound(null);
        setLookupError("We couldn't find that postcode. Check it and try again.");
      } else {
        setFound({ postcode, addresses: answer.addresses });
      }
    } catch {
      setLookupError("We couldn't look up addresses just now. Try again.");
    } finally {
      setLooking(false);
    }
  }

  const address = found?.addresses.find((a) => a.id === addressId);
  const change =
    found && address && overnight
      ? {
          kind: "address",
          postcode: found.postcode,
          addressLine1: address.line1,
          addressLine2: address.line2 ?? null,
          town: address.town,
          overnightLocation: overnight as OvernightLocation,
        }
      : null;

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Change address"
      reference={policy.reference}
      change={change}
    >
      <div className="pc-row pc-row--end">
        <Input
          label="New postcode"
          iconLeft="map-pin"
          value={postcode}
          error={lookupError ?? undefined}
          onChange={(e) => setPostcode(e.target.value)}
        />
        <Button
          variant="secondary"
          loading={looking}
          disabled={!postcode.trim()}
          onClick={() => void lookUp()}
        >
          Find address
        </Button>
      </div>
      {found ? (
        <Select
          label="Address"
          placeholder="Choose your address"
          options={found.addresses.map((a) => ({
            value: a.id,
            label: [a.line1, a.line2].filter(Boolean).join(", "),
          }))}
          value={addressId}
          onChange={(e) => setAddressId(e.target.value)}
        />
      ) : null}
      <Select
        label="Where is the car parked overnight?"
        placeholder="Choose where"
        options={overnightOptions}
        value={overnight}
        onChange={(e) => setOvernight(e.target.value)}
      />
    </ChangeDialog>
  );
}

const excessOptions = VOLUNTARY_EXCESS_PENCE.map((pence) => ({
  value: String(pence),
  label: formatPounds(pence).replace(".00", ""),
}));

function ChangeCoverDialog({ policy, onClose, onApplied }: DialogProps) {
  const [coverLevel, setCoverLevel] = useState<CoverLevel>(policy.coverLevel as CoverLevel);
  const [addons, setAddons] = useState<string[]>(policy.addons.map((a) => a.addon).sort());
  const [excess, setExcess] = useState(policy.voluntaryExcessPence);
  const change = { kind: "cover", coverLevel, addons, voluntaryExcessPence: excess };

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Change cover"
      reference={policy.reference}
      change={change}
      fields={(priced) => {
        const levels = priced?.levels ?? [];
        const offered = priced?.addons ?? policy.addons;
        return (
          <>
            <CoverageGroup
              label="Choose your cover"
              value={coverLevel}
              onChange={(id) => setCoverLevel(id as CoverLevel)}
              options={coverLevels.map((level) => {
                const line = levels.find((l) => l.coverLevel === level);
                return {
                  id: level,
                  name: tierName(level),
                  description: line
                    ? line.available
                      ? (line.priceLine ?? undefined)
                      : "Not available online"
                    : undefined,
                  disabled: line ? !line.available : false,
                };
              })}
            />
            {offered.map(({ addon, annualPricePence }) => {
              const copy = addonCopy(addon);
              return (
                <Checkbox
                  key={addon}
                  label={copy.label}
                  description={`${formatPounds(annualPricePence)} a year`}
                  checked={addons.includes(addon)}
                  onChange={(e) =>
                    setAddons((current) =>
                      e.target.checked
                        ? [...current, addon].sort()
                        : current.filter((a) => a !== addon),
                    )
                  }
                />
              );
            })}
            <Select
              label="Voluntary excess"
              options={excessOptions}
              value={String(excess)}
              onChange={(e) => setExcess(Number(e.target.value))}
            />
          </>
        );
      }}
    />
  );
}
