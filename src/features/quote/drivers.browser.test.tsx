import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { AboutYouStep } from "./AboutYouStep";
import { ClaimsStep } from "./ClaimsStep";
import { completeJourney, FIXTURE_TODAY, golf } from "./journey-fixtures";
import { beginJourney, journeyKey, readJourney, setVehicle, type Journey } from "./journey-store";
import { LicenceStep } from "./LicenceStep";
import { NamedDriversStep } from "./NamedDriversStep";

// The driver steps' screens (5.3): About you, Licence and driving (11), Claims (12) and Named
// drivers (12a). Each test starts from a car journey on 11 Nov 2026.

const occupations = [
  { key: "accountant", label: "Accountant" },
  { key: "homemaker", label: "Homemaker" },
  { key: "plumber", label: "Plumber" },
  { key: "retired", label: "Retired" },
  { key: "self_employed", label: "Self-employed (other)" },
  { key: "teacher", label: "Teacher" },
];

function client(seed = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) queryClient.setQueryData(["occupations"], { occupations });
  return queryClient;
}

function withQuery(ui: ReactNode, queryClient = client()) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function store(journey: Journey) {
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(journey));
}

function carOnly(): Journey {
  beginJourney("car", "E8 3RL");
  setVehicle(golf);
  return readJourney("car")!;
}

/** The journey with everything up to (not including) `step` answered */
function upTo(step: "driving" | "claims" | "drivers"): Journey {
  const journey = completeJourney();
  delete journey.namedDrivers;
  if (step !== "drivers") delete journey.claims;
  if (step === "driving") {
    delete journey.usage;
    const { licenceType: _t, licenceDate: _d, noClaimsYears: _n, ...about } = journey.mainDriver!;
    journey.mainDriver = about;
  }
  store(journey);
  return readJourney("car")!;
}

const group = (name: string) => page.getByRole("group", { name, exact: true });
const box = (name: string) => page.getByRole("textbox", { name, exact: true });
const select = (name: string) => page.getByRole("combobox", { name, exact: true });

async function fillDate(legend: string, day: string, month: string, year: string, nth = 0) {
  const g = group(legend).nth(nth);
  await userEvent.fill(g.getByRole("textbox", { name: "Day" }), day);
  await userEvent.fill(g.getByRole("textbox", { name: "Month" }), month);
  await userEvent.fill(g.getByRole("textbox", { name: "Year" }), year);
}

beforeEach(() => sessionStorage.clear());

describe("About you", () => {
  function renderAbout(queryClient = client()) {
    const onDone = vi.fn();
    const screen = withQuery(
      <AboutYouStep journey={carOnly()} today={FIXTURE_TODAY} onBack={() => {}} onDone={onDone} />,
      queryClient,
    );
    return { onDone, screen };
  }

  async function fillAbout() {
    await userEvent.fill(box("First name"), "Alex");
    await userEvent.fill(box("Last name"), "Morgan");
    await fillDate("Date of birth", "12", "5", "1991");
    await userEvent.fill(box("Address line 1"), "18 Albion Road");
    await userEvent.fill(box("Town or city"), "London");
  }

  it("shows the car and asks about the driver", async () => {
    renderAbout();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Tell us about you");
    await expect
      .element(
        page.getByText(
          "We’ll use this information to build your quote for the 2021 Volkswagen Golf.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("Home postcode: E8 3RL.")).toBeVisible();
  });

  it("shows the job list for Employed, without the statuses, and hides it for Retired", async () => {
    renderAbout();
    await userEvent.selectOptions(select("Employment status"), "Employed");
    const options = select("Occupation").element().querySelectorAll("option");
    const labels = [...options].map((o) => o.textContent);
    expect(labels).toContain("Plumber");
    expect(labels).not.toContain("Retired");
    expect(labels).not.toContain("Self-employed (other)");
    await userEvent.selectOptions(select("Employment status"), "Retired");
    await expect.element(select("Occupation")).not.toBeInTheDocument();
  });

  it("offers self-employed (other) to the self-employed", async () => {
    renderAbout();
    await userEvent.selectOptions(select("Employment status"), "Self-employed");
    await userEvent.selectOptions(select("Occupation"), "Self-employed (other)");
    await expect.element(select("Occupation")).toHaveDisplayValue("Self-employed (other)");
  });

  it("focuses the first empty field on an empty submit", async () => {
    const { onDone } = renderAbout();
    await page.getByRole("button", { name: "Continue to your licence" }).click();
    await expect.element(page.getByText("Enter your first name.")).toBeVisible();
    await expect.element(box("First name")).toHaveFocus();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves the answers and moves on", async () => {
    const { onDone } = renderAbout();
    await fillAbout();
    await userEvent.selectOptions(select("Employment status"), "Employed");
    await userEvent.selectOptions(select("Occupation"), "Plumber");
    await page.getByRole("button", { name: "Continue to your licence" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(readJourney("car")!.mainDriver).toMatchObject({
      firstName: "Alex",
      dateOfBirth: "1991-05-12",
      status: "employed",
      occupation: "plumber",
    });
  });

  it("still lets a retired driver continue when the occupation list fails", async () => {
    const failing = client(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const { onDone } = renderAbout(failing);
    await userEvent.selectOptions(select("Employment status"), "Employed");
    await expect
      .element(page.getByText("We couldn’t load the list of occupations. Try again in a moment."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await userEvent.selectOptions(select("Employment status"), "Retired");
    await fillAbout();
    await page.getByRole("button", { name: "Continue to your licence" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    vi.restoreAllMocks();
  });

  it("asks again for a stored occupation the list no longer has", async () => {
    const journey = completeJourney();
    journey.mainDriver!.occupation = "astronaut";
    store(journey);
    withQuery(
      <AboutYouStep
        journey={readJourney("car")!}
        today={FIXTURE_TODAY}
        onBack={() => {}}
        onDone={() => {}}
      />,
    );
    await expect.element(select("Occupation")).toHaveValue("");
    await expect.element(box("First name")).toHaveValue("Alex");
  });
});

describe("Licence and driving", () => {
  it("refuses a provisional licence", async () => {
    const onDone = vi.fn();
    withQuery(
      <LicenceStep
        journey={upTo("driving")}
        today={FIXTURE_TODAY}
        onBack={() => {}}
        onDone={onDone}
      />,
    );
    await expect
      .element(
        page.getByText("A few more details about Alex Morgan and how the Volkswagen Golf is used."),
      )
      .toBeVisible();
    await userEvent.selectOptions(select("Licence type"), "Provisional UK");
    await page.getByRole("button", { name: "Continue to driving history" }).click();
    await expect
      .element(page.getByText("Kerb can’t quote for a provisional licence yet."))
      .toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves the licence and how the car is used", async () => {
    const onDone = vi.fn();
    withQuery(
      <LicenceStep
        journey={upTo("driving")}
        today={FIXTURE_TODAY}
        onBack={() => {}}
        onDone={onDone}
      />,
    );
    await userEvent.selectOptions(select("Licence type"), "Full UK");
    await fillDate("Date full licence obtained", "18", "7", "2010");
    await userEvent.selectOptions(select("Years of no-claims discount"), "5 years");
    await userEvent.fill(box("Annual mileage"), "8,000");
    await userEvent.fill(box("Current mileage"), "18200");
    await userEvent.selectOptions(select("Use of the car"), "Social, domestic and commuting");
    await userEvent.selectOptions(select("Where is the car kept overnight?"), "Driveway");
    await page.getByRole("button", { name: "Continue to driving history" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    const journey = readJourney("car")!;
    expect(journey.mainDriver).toMatchObject({ licenceType: "full_uk", noClaimsYears: 5 });
    expect(journey.usage).toEqual({
      annualMileage: 8000,
      currentMileage: 18200,
      usage: "commuting",
      overnight: "driveway",
    });
  });
});

describe("Claims", () => {
  function renderClaims() {
    const onDone = vi.fn();
    withQuery(
      <ClaimsStep
        journey={upTo("claims")}
        today={FIXTURE_TODAY}
        onBack={() => {}}
        onDone={onDone}
      />,
    );
    return onDone;
  }
  const question = () => group("Any accidents, claims or losses in the last 5 years?");

  it("adds and removes incidents, keeping each one's answers", async () => {
    renderClaims();
    await question().getByText("Yes", { exact: true }).click();
    await fillDate("Date of incident", "14", "2", "2022");
    await page.getByRole("button", { name: "Add another incident" }).click();
    await fillDate("Date of incident", "3", "3", "2024", 1);
    await page.getByRole("button", { name: "Remove incident 1" }).click();
    await expect
      .element(group("Date of incident").getByRole("textbox", { name: "Year" }))
      .toHaveValue("2024");
  });

  it("needs the confirmation", async () => {
    const onDone = renderClaims();
    await question().getByText("No", { exact: true }).click();
    await page.getByRole("button", { name: "Continue to named drivers" }).click();
    await expect.element(page.getByText("Confirm your driving history to continue.")).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
    await page.getByText("I confirm my driving history is complete and accurate.").click();
    await page.getByRole("button", { name: "Continue to named drivers" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(readJourney("car")!.claims).toEqual({ any: false, incidents: [], confirmed: true });
  });

  it("saves an incident", async () => {
    const onDone = renderClaims();
    await question().getByText("Yes", { exact: true }).click();
    await fillDate("Date of incident", "14", "2", "2022");
    await userEvent.selectOptions(select("Type of incident"), "Collision");
    await userEvent.selectOptions(select("Responsibility"), "Not at fault");
    await userEvent.fill(box("Total claim cost"), "1,200");
    await page.getByText("I confirm my driving history is complete and accurate.").click();
    await page.getByRole("button", { name: "Continue to named drivers" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(readJourney("car")!.claims!.incidents).toMatchObject([
      { date: "2022-02-14", type: "collision", fault: "not_at_fault", costPounds: 1200 },
    ]);
  });
});

describe("Named drivers", () => {
  function renderDrivers(journey = upTo("drivers")) {
    const onDone = vi.fn();
    withQuery(
      <NamedDriversStep
        journey={journey}
        today={FIXTURE_TODAY}
        onBack={() => {}}
        onDone={onDone}
      />,
    );
    return onDone;
  }
  const question = () => group("Would you like to add a named driver?");

  it("adds up to 4 drivers", async () => {
    renderDrivers();
    await question().getByText("Yes", { exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Named driver 1" })).toBeVisible();
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Add another driver" }).click();
    await expect.element(page.getByRole("heading", { name: "Named driver 4" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Add another driver" }))
      .not.toBeInTheDocument();
  });

  it("removes driver 2 of 3, keeping driver 3's answers and moving focus to it", async () => {
    renderDrivers();
    await question().getByText("Yes", { exact: true }).click();
    await page.getByRole("button", { name: "Add another driver" }).click();
    await page.getByRole("button", { name: "Add another driver" }).click();
    await userEvent.fill(box("First name").nth(2), "Robin");
    await page.getByRole("button", { name: "Remove driver 2" }).click();
    await expect.element(box("First name").nth(1)).toHaveValue("Robin");
    await expect.element(page.getByRole("heading", { name: "Named driver 2" })).toHaveFocus();
    await expect
      .element(page.getByRole("heading", { name: "Robin’s licence and driving history" }))
      .toBeVisible();
  });

  it("goes back to No when every driver is removed", async () => {
    renderDrivers();
    await question().getByText("Yes", { exact: true }).click();
    await page.getByRole("button", { name: "Remove driver 1" }).click();
    await expect.element(question().getByRole("radio", { name: "No" })).toBeChecked();
    await expect.element(question().getByRole("radio", { name: "No" })).toHaveFocus();
  });

  it("saves a named driver with a claims count", async () => {
    const onDone = renderDrivers();
    await question().getByText("Yes", { exact: true }).click();
    await userEvent.fill(box("First name"), "Jamie");
    await userEvent.fill(box("Last name"), "Morgan");
    await fillDate("Date of birth", "24", "9", "2007");
    await userEvent.selectOptions(select("Relationship to you"), "Son or daughter");
    await userEvent.selectOptions(select("Employment status"), "Student");
    await userEvent.selectOptions(select("Licence type"), "Full UK");
    await fillDate("Date full licence obtained", "1", "10", "2025");
    await group("Any accidents, claims or losses in the last 5 years?")
      .getByText("Yes", { exact: true })
      .click();
    await userEvent.selectOptions(select("How many?"), "2");
    await page.getByRole("button", { name: "Get my car quote" }).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(readJourney("car")!.namedDrivers!.drivers).toMatchObject([
      {
        firstName: "Jamie",
        dateOfBirth: "2007-09-24",
        relationship: "child",
        status: "student",
        occupation: "student",
        anyClaims: true,
        pastClaims: 2,
      },
    ]);
  });
});
