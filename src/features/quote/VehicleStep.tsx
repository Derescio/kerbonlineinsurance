import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Card } from "#/components/display/Card";

import { findCar, type PickerCar } from "./catalogue";
import { catalogueQuery } from "./catalogue-query";
import { findDemoPlate } from "./demo-plates";
import { readJourney, setLastPlate, setVehicle, type VehicleChoice } from "./journey-store";
import { normalisePlate, plateError } from "./plate";
import { CatalogueError, PlateLookup } from "./PlateLookup";
import { VehicleNotFound } from "./VehicleNotFound";
import { VehiclePicker } from "./VehiclePicker";

/** Screen 08, 09 or 10; the route keeps it in the URL as `vehicle` (5.2, call 9) */
export type VehicleStepView = "plate" | "manual" | "not-found";

function pickerCarOf(vehicle: VehicleChoice): PickerCar {
  return {
    id: vehicle.catalogueVariantId,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    variant: vehicle.variant,
    fuelType: vehicle.fuelType,
    doors: vehicle.doors,
    transmission: "",
  };
}

/**
 * The car journey's first step (5.2). The lookup runs in the browser against the demo plates and
 * the catalogue, so a visitor's plate never reaches the server (call 7). The confirmed car goes
 * into the tab's journey object (call 12).
 */
export function VehicleStep({
  view,
  onView,
}: {
  view: VehicleStepView;
  onView: (view: VehicleStepView) => void;
}) {
  const catalogue = useQuery(catalogueQuery);
  const cars = catalogue.data?.cars;

  const [confirmed, setConfirmed] = useState<VehicleChoice | null>(null);
  const [plate, setPlate] = useState("");
  const [plateErr, setPlateErr] = useState<string>();
  const [pendingFind, setPendingFind] = useState(false);
  const [fillFrom, setFillFrom] = useState<PickerCar | null>(null);
  const [demoPlate, setDemoPlate] = useState<string | null>(null);
  const [initial, setInitial] = useState<PickerCar | null>(null);
  // A new picker for each "Change", so it starts from that car
  const [pickerKey, setPickerKey] = useState(0);

  // sessionStorage only exists in the browser, so the stored answers load after hydration
  useEffect(() => {
    const journey = readJourney("car");
    if (journey?.vehicle) setConfirmed(journey.vehicle);
    if (journey?.lastPlate) setPlate((current) => current || (journey.lastPlate ?? ""));
  }, []);

  // A stored car a deploy has since withdrawn is forgotten quietly (call 12)
  useEffect(() => {
    if (!cars || !confirmed) return;
    if (!cars.some((car) => car.id === confirmed.catalogueVariantId)) {
      setVehicle(null);
      setConfirmed(null);
    }
  }, [cars, confirmed]);

  function lookUp(list: readonly PickerCar[]) {
    const demo = findDemoPlate(plate);
    const car = demo ? findCar(list, demo) : null;
    if (demo && car) {
      setFillFrom(car);
      setDemoPlate(demo.plate);
      setInitial(null);
      setPickerKey((key) => key + 1);
      onView("manual");
    } else {
      setLastPlate(plate.trim());
      onView("not-found");
    }
  }

  // "Find my car" before the catalogue arrived waits for it, unless the visitor has moved on
  useEffect(() => {
    if (pendingFind && cars) {
      setPendingFind(false);
      lookUp(cars);
    }
  }, [pendingFind, cars]);

  // Each new screen moves focus to its heading, so keyboard and screen-reader users land on it
  const root = useRef<HTMLDivElement>(null);
  const screen = confirmed ? "confirmed" : view;
  const shown = useRef(screen);
  useEffect(() => {
    if (shown.current === screen) return;
    shown.current = screen;
    root.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen]);

  function find() {
    if (!normalisePlate(plate)) {
      setPlateErr(plateError);
      return;
    }
    setPlateErr(undefined);
    if (cars) lookUp(cars);
    else setPendingFind(true);
  }

  function manual() {
    setPendingFind(false);
    setFillFrom(null);
    setDemoPlate(null);
    setInitial(null);
    setPickerKey((key) => key + 1);
    onView("manual");
  }

  function confirm(car: PickerCar) {
    const vehicle: VehicleChoice = {
      catalogueVariantId: car.id,
      make: car.make,
      model: car.model,
      year: car.year,
      variant: car.variant,
      fuelType: car.fuelType,
      doors: car.doors,
      ...(demoPlate && fillFrom?.id === car.id && { demoPlate }),
    };
    setVehicle(vehicle);
    setConfirmed(vehicle);
  }

  function change() {
    if (!confirmed) return;
    setPendingFind(false);
    setInitial(
      cars?.find((car) => car.id === confirmed.catalogueVariantId) ?? pickerCarOf(confirmed),
    );
    setFillFrom(null);
    setVehicle(null);
    setConfirmed(null);
    setPickerKey((key) => key + 1);
    onView("manual");
  }

  const loadError = catalogue.isError ? (
    <CatalogueError onRetry={() => void catalogue.refetch()} />
  ) : null;
  const finding = pendingFind && !catalogue.isError;

  return (
    <div ref={root} className="quote-step">
      {content()}
    </div>
  );

  function content() {
    if (confirmed) {
      return (
        <>
          <header className="quote-heading">
            <p className="quote-heading__overline">Car · Your details</p>
            <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
              Your car
            </h1>
            <p className="quote-heading__intro">
              Your car: {confirmed.make} {confirmed.model} {confirmed.variant}, {confirmed.year}.{" "}
              <button type="button" className="quote-link" onClick={change}>
                Change<span className="kb-sr-only"> your car</span>
              </button>
            </p>
          </header>
          <Card padding="lg" className="quote-slot">
            <p>Driver details arrive in 5.3</p>
          </Card>
        </>
      );
    }

    const plateProps = {
      plate,
      onPlate: (value: string) => {
        setPlate(value);
        setPlateErr(undefined);
      },
      onFind: find,
      error: plateErr,
      finding,
      loadError,
      onManual: manual,
    };

    if (view === "not-found") return <VehicleNotFound {...plateProps} />;
    if (view === "manual") {
      return (
        <VehiclePicker
          key={pickerKey}
          cars={cars}
          fillFrom={fillFrom}
          initial={initial}
          fromPlate={demoPlate !== null}
          loadError={loadError}
          onConfirm={confirm}
          onBack={() => onView("plate")}
        />
      );
    }
    return <PlateLookup {...plateProps} />;
  }
}
