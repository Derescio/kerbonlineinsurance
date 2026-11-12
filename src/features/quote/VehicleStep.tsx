import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";

import { findCar, fuelLabel, type PickerCar } from "./catalogue";
import { catalogueQuery } from "./catalogue-query";
import { findDemoPlate } from "./demo-plates";
import {
  readJourney,
  setLastPlate,
  setVehicle,
  type Journey,
  type VehicleChoice,
} from "./journey-store";
import { CarCard, DetailsTabs, HelpCard, JourneyPage, StepNav, type CarCardCar } from "./page-kit";
import { normalisePlate, plateError } from "./plate";
import { CatalogueError, PlateLookup } from "./PlateLookup";
import { todayIso } from "./schemas/dates";
import { StepHeading } from "./step-kit";
import { tabStates, type DetailsTab } from "./steps";
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
 * The car journey's first step (5.2), in the revamp's frame (5.4b): R01 the picker, R02 the
 * confirmed car, and screens 08 and 10 as they were. The lookup runs in the browser against the
 * demo plates and the catalogue, so a visitor's plate never reaches the server (call 7). The
 * confirmed car goes into the tab's journey object (call 12).
 */
export function VehicleStep({
  view,
  postcode,
  onView,
  onContinue,
  onBack,
  onTab,
}: {
  view: VehicleStepView;
  postcode: string;
  onView: (view: VehicleStepView) => void;
  /** From the confirmed car to About you (5.3, call 6) */
  onContinue: () => void;
  /** Back from the registration screen, out of the car step (5.4b, call 9) */
  onBack: () => void;
  /** A finished driver step's tab (5.4b, call 5) */
  onTab: (tab: Exclude<DetailsTab, "car">) => void;
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
  // What the picker has chosen so far, for the "Your car" card (5.4b, call 6)
  const [liveCar, setLiveCar] = useState<CarCardCar | null>(null);
  // Where the confirmed car was chosen, for R02's Back (5.4b, call 8)
  const [chosenFrom, setChosenFrom] = useState<VehicleStepView>("manual");
  // The stored journey, for the tabs: read after hydration and after each change to the car
  const [journey, setJourney] = useState<Journey | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const screen = confirmed ? "confirmed" : view;
  const shown = useRef(screen);
  const restoring = useRef(false);

  // sessionStorage only exists in the browser, so the stored answers load after hydration. A car
  // found there is where the page starts, not a move, so focus stays put.
  useEffect(() => {
    const stored = readJourney("car");
    setJourney(stored);
    if (stored?.vehicle) {
      restoring.current = true;
      setConfirmed(stored.vehicle);
    }
    if (stored?.lastPlate) setPlate((current) => current || (stored.lastPlate ?? ""));
  }, []);

  // A stored car a deploy has since withdrawn is forgotten quietly (call 12)
  useEffect(() => {
    if (!cars || !confirmed) return;
    if (!cars.some((car) => car.id === confirmed.catalogueVariantId)) {
      setVehicle(null);
      setConfirmed(null);
      setJourney(readJourney("car"));
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
  useEffect(() => {
    if (shown.current === screen) return;
    shown.current = screen;
    if (restoring.current) {
      restoring.current = false;
      return;
    }
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
    const fromPlate = demoPlate !== null && fillFrom?.id === car.id;
    const vehicle: VehicleChoice = {
      catalogueVariantId: car.id,
      make: car.make,
      model: car.model,
      year: car.year,
      variant: car.variant,
      fuelType: car.fuelType,
      doors: car.doors,
      ...(fromPlate && { demoPlate: demoPlate! }),
    };
    setVehicle(vehicle);
    setConfirmed(vehicle);
    setJourney(readJourney("car"));
    setChosenFrom(fromPlate ? "plate" : "manual");
  }

  /** Forgets the confirmed car; the driver answers stay in the tab (5.4b, call 6) */
  function forget(): VehicleChoice | null {
    if (!confirmed) return null;
    setPendingFind(false);
    setFillFrom(null);
    setVehicle(null);
    setConfirmed(null);
    setJourney(readJourney("car"));
    return confirmed;
  }

  /** R02's "Change car": the picker, starting from that car (5.2, plan P5) */
  function change() {
    const car = forget();
    if (!car) return;
    setInitial(cars?.find((c) => c.id === car.catalogueVariantId) ?? pickerCarOf(car));
    setPickerKey((key) => key + 1);
    onView("manual");
  }

  /** The card's "Change car or postcode": the registration screen, where the postcode can change */
  function changeCarOrPostcode() {
    if (!forget()) return;
    setInitial(null);
    setLiveCar(null);
    setPickerKey((key) => key + 1);
    onView("plate");
  }

  /** R02's Back: to where the car was chosen */
  function backFromConfirmed() {
    if (chosenFrom === "plate") changeCarOrPostcode();
    else change();
  }

  const loadError = catalogue.isError ? (
    <CatalogueError onRetry={() => void catalogue.refetch()} />
  ) : null;
  const finding = pendingFind && !catalogue.isError;

  const tabs = (
    <DetailsTabs
      states={tabStates(journey, "car", todayIso())}
      onOpen={(tab) => {
        if (tab !== "car") onTab(tab);
      }}
    />
  );
  const help = (
    <HelpCard>
      Keep your vehicle documents and driving licence nearby as you complete your details.
    </HelpCard>
  );

  return (
    <div ref={root} className="quote-step">
      {content()}
    </div>
  );

  function content() {
    if (confirmed) {
      return (
        <JourneyPage
          heading={
            <StepHeading
              overline="Car insurance / Your details"
              title="Your car, confirmed"
              intro="Check these details before moving on to your information."
            />
          }
          tabs={tabs}
          aside={
            <>
              <CarCard car={confirmed} postcode={postcode} onChange={changeCarOrPostcode} />
              {help}
            </>
          }
        >
          <Card padding="lg" className="quote-confirmed">
            <Icon name="circle-check" size={24} />
            <h2 className="kb-h3">Is this your car?</h2>
            <p className="quote-confirmed__name">
              {confirmed.make} {confirmed.model} {confirmed.variant}
            </p>
            <p>
              {confirmed.year} · {fuelLabel(confirmed.fuelType)} · {confirmed.doors} doors
            </p>
            <p className="quote-confirmed__hint">
              Check the model and variant against your vehicle documents.
            </p>
            <Button variant="secondary" size="sm" onClick={change}>
              Change car
            </Button>
          </Card>
          <StepNav
            onBack={backFromConfirmed}
            next={
              <Button variant="accent" iconRight="arrow-right" onClick={onContinue}>
                Continue to your details
              </Button>
            }
          />
        </JourneyPage>
      );
    }

    const aside = (
      <>
        <CarCard car={view === "manual" ? liveCar : null} postcode={postcode} />
        {help}
      </>
    );
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
      tabs,
      aside,
    };

    if (view === "not-found") {
      return <VehicleNotFound {...plateProps} onBack={() => onView("plate")} />;
    }
    if (view === "manual") {
      return (
        <VehiclePicker
          key={pickerKey}
          cars={cars}
          fillFrom={fillFrom}
          initial={initial}
          loadError={loadError}
          tabs={tabs}
          aside={aside}
          onChoiceChange={setLiveCar}
          onConfirm={confirm}
          onBack={() => onView("plate")}
        />
      );
    }
    return <PlateLookup {...plateProps} onBack={onBack} />;
  }
}
