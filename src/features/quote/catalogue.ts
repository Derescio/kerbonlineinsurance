// The picker's view of the catalogue (5.2, call 10): one row per variant in one model year, as
// GET /api/catalogue sends it. Value and insurance group stay on the server.

export interface PickerCar {
  id: string;
  make: string;
  model: string;
  year: number;
  variant: string;
  fuelType: string;
  doors: number;
  transmission: string;
}

export interface CarChoice {
  make: string;
  model: string;
  year: number;
  variant: string;
}

const atoz = (a: string, b: string) => a.localeCompare(b, "en-GB");
const unique = <T>(values: T[]) => [...new Set(values)];

/** Every make, A to Z */
export function makesOf(cars: readonly PickerCar[]): string[] {
  return unique(cars.map((c) => c.make)).sort(atoz);
}

/** The make's models, A to Z */
export function modelsOf(cars: readonly PickerCar[], make: string): string[] {
  return unique(cars.filter((c) => c.make === make).map((c) => c.model)).sort(atoz);
}

/** The model's years, newest first */
export function yearsOf(cars: readonly PickerCar[], make: string, model: string): number[] {
  return unique(cars.filter((c) => c.make === make && c.model === model).map((c) => c.year)).sort(
    (a, b) => b - a,
  );
}

/** That make, model and year's variants, A to Z */
export function variantsOf(
  cars: readonly PickerCar[],
  make: string,
  model: string,
  year: number,
): PickerCar[] {
  return cars
    .filter((c) => c.make === make && c.model === model && c.year === year)
    .sort((a, b) => atoz(a.variant, b.variant));
}

export function findCar(cars: readonly PickerCar[], choice: CarChoice): PickerCar | null {
  return (
    cars.find(
      (c) =>
        c.make === choice.make &&
        c.model === choice.model &&
        c.year === choice.year &&
        c.variant === choice.variant,
    ) ?? null
  );
}

/** "petrol" → "Petrol" */
export function fuelLabel(fuelType: string): string {
  return fuelType.charAt(0).toUpperCase() + fuelType.slice(1);
}
