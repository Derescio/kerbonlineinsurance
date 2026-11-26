import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import {
  findCar,
  fuelLabel,
  makesOf,
  modelsOf,
  variantsOf,
  yearsOf,
  type PickerCar,
} from "#/features/quote/catalogue";
import { catalogueQuery } from "#/features/quote/catalogue-query";
import { findDemoPlate } from "#/features/quote/demo-plates";
import { normalisePlate } from "#/features/quote/plate";
import { errors as driverErrors } from "#/features/quote/schemas/driver-steps";
import type { PolicyDetail } from "#/server/data/policies";

import { ChangeDialog } from "./ChangeDialog";

// Change car (6.3c, decision 3; Figma 183:3785 found, 282:3977 not found, 282:4033 chosen by
// hand). The plate is matched to the demo plates in the browser, as the quote journey does; the
// server checks it again and reads the car from its own catalogue.

export const SAME_CAR = "That's the car you're already insured for.";
const MILEAGE_HINT = "What the new car's odometer reads now.";
/** A full UK plate's length, so a half-typed one isn't "not found" yet */
const PLATE_LENGTH = 7;

/** Whole miles typed in a box, commas allowed; null when it isn't one */
function miles(text: string): number | null {
  const digits = text.replace(/,/g, "").trim();
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value <= 999_999 ? value : null;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function ChangeCarDialog({
  policy,
  onClose,
  onApplied,
}: {
  policy: PolicyDetail;
  onClose: () => void;
  onApplied: () => void;
}) {
  const cars = useQuery(catalogueQuery).data?.cars ?? [];
  const [manual, setManual] = useState(false);
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [variantId, setVariantId] = useState("");
  const [mileage, setMileage] = useState("");

  const demo = findDemoPlate(plate);
  const plateCar = demo ? findCar(cars, demo) : null;
  const notFound = !plateCar && normalisePlate(plate).length >= PLATE_LENGTH;
  const manualCar = cars.find((c) => c.id === variantId) ?? null;
  const car: PickerCar | null = manual ? manualCar : plateCar;
  const same = car !== null && car.id === policy.car?.catalogueVariantId;
  const currentMileage = miles(mileage);
  const mileageError =
    mileage.trim() && currentMileage === null ? driverErrors.currentMileage : undefined;

  const change =
    car && !same && currentMileage !== null
      ? {
          kind: "car_replaced",
          catalogueVariantId: car.id,
          registration: manual ? null : demo!.plate,
          currentMileage,
        }
      : null;

  function choose(next: "make" | "model" | "year", value: string) {
    if (next === "make") {
      setMake(value);
      setModel("");
      setYear("");
    } else if (next === "model") {
      setModel(value);
      setYear("");
    } else {
      setYear(value);
    }
    setVariantId("");
  }

  return (
    <ChangeDialog
      open
      onClose={onClose}
      onApplied={onApplied}
      title="Change car"
      reference={policy.reference}
      change={change}
    >
      {manual ? (
        <>
          <Select
            label="Make"
            placeholder="Choose"
            options={makesOf(cars)}
            value={make}
            onChange={(e) => choose("make", e.target.value)}
          />
          <Select
            label="Model"
            placeholder="Choose"
            options={make ? modelsOf(cars, make) : []}
            value={model}
            disabled={!make}
            onChange={(e) => choose("model", e.target.value)}
          />
          <Select
            label="Year"
            placeholder="Choose"
            options={make && model ? yearsOf(cars, make, model).map(String) : []}
            value={year}
            disabled={!model}
            onChange={(e) => choose("year", e.target.value)}
          />
          <Select
            label="Variant"
            placeholder="Choose"
            options={
              make && model && year
                ? variantsOf(cars, make, model, Number(year)).map((c) => ({
                    value: c.id,
                    label: c.variant,
                  }))
                : []
            }
            value={variantId}
            disabled={!year}
            onChange={(e) => setVariantId(e.target.value)}
          />
        </>
      ) : (
        <>
          <Input
            label="New car's registration"
            variant="plate"
            placeholder="KR24 BXL"
            autoComplete="off"
            spellCheck={false}
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            hint="Kerb is a demo, so only its demo plates are recognised: VW21 GQL, FD69 KQB, VX22 CQS, TY23 HIQ, TS24 EIV and BM20 MIQ."
          />
          {plateCar ? (
            <Alert
              tone="success"
              title={`We found it: ${plateCar.make} ${plateCar.model}, ${plateCar.year}`}
            >
              <p>
                {plateCar.variant}, {lowerFirst(fuelLabel(plateCar.fuelType))},{" "}
                {plateCar.transmission}. Not right? Enter the reg again.
              </p>
            </Alert>
          ) : null}
          {notFound ? (
            <Alert tone="neutral" title="We couldn't find that car">
              <p>Check the registration and try again, or choose your car from our list.</p>
            </Alert>
          ) : null}
        </>
      )}
      {car ? (
        <Input
          label="Current mileage"
          inputMode="numeric"
          hint={MILEAGE_HINT}
          value={mileage}
          error={mileageError}
          onChange={(e) => setMileage(e.target.value)}
        />
      ) : null}
      {same ? (
        <Alert tone="info">
          <p>{SAME_CAR}</p>
        </Alert>
      ) : null}
      <div>
        <Button variant="ghost" onClick={() => setManual(!manual)}>
          {manual ? "Look up by registration instead" : "Choose my car manually"}
        </Button>
      </div>
    </ChangeDialog>
  );
}
