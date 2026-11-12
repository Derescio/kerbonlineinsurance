import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { AboutYouStep } from "./AboutYouStep";
import { ClaimsStep } from "./ClaimsStep";
import { DriverSteps } from "./DriverSteps";
import { completeJourney, FIXTURE_TODAY, golf } from "./journey-fixtures";
import { beginJourney, journeyKey, readJourney, setVehicle, type Journey } from "./journey-store";
import { LicenceStep } from "./LicenceStep";
import { NamedDriversStep } from "./NamedDriversStep";
import type { QuoteStep } from "./search";
import { addYears, todayIso } from "./schemas/dates";
import { priceCar } from "./server";

// The price (5.4) is mocked at the server-function boundary: the server's own tests price it
vi.mock("./server", () => ({ priceCar: vi.fn() }));
const price = vi.mocked(priceCar);
const QUOTED = { status: "quoted", annualPence: 106_378, monthlyPaymentPence: 9_751 } as const;

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

beforeEach(() => {
  sessionStorage.clear();
  price.mockReset();
  price.mockResolvedValue(QUOTED);
});

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
    await expect.element(page.getByText("Home postcode: E8 3RL")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "About you", level: 2 })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Home address" })).toBeVisible();
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
    await withQuery(
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
    await withQuery(
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
    await page.getByRole("button", { name: "Continue to claims" }).click();
    await expect
      .element(page.getByText("Kerb can’t quote for a provisional licence yet."))
      .toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves the licence and how the car is used", async () => {
    const onDone = vi.fn();
    await withQuery(
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
    await page.getByRole("button", { name: "Continue to claims" }).click();
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
    void withQuery(
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
    await expect
      .element(page.getByRole("checkbox"))
      .toHaveAccessibleDescription("Confirm your driving history to continue.");
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
    void withQuery(
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

describe("the driver steps in order", () => {
  type Move = { step: QuoteStep | undefined; replace: boolean };

  function Harness({ initial, moves }: { initial: QuoteStep; moves: Move[] }) {
    const [step, setStep] = useState<QuoteStep | undefined>(initial);
    return step ? (
      <DriverSteps
        step={step}
        onStep={(next, opts) => {
          moves.push({ step: next, replace: opts?.replace ?? false });
          setStep(next);
        }}
      />
    ) : (
      <p>car step</p>
    );
  }

  function renderFlow(initial: QuoteStep) {
    const moves: Move[] = [];
    const screen = withQuery(<Harness initial={initial} moves={moves} />);
    return { moves, screen };
  }

  /** The fixture journey, moved so its dates hold against the real today */
  function storeComplete(change?: (journey: Journey) => void) {
    const journey = completeJourney();
    journey.claims = { any: false, incidents: [], confirmed: true };
    change?.(journey);
    store(journey);
  }

  it("ticks finished steps in the tabs and opens one when clicked (5.4b, call 5)", async () => {
    storeComplete((journey) => delete journey.namedDrivers);
    const { moves } = renderFlow("claims");
    const tabs = page.getByRole("navigation", { name: "Your details" });
    await expect
      .element(tabs.getByRole("listitem").filter({ hasText: "Claims" }))
      .toHaveAttribute("aria-current", "step");
    await tabs.getByRole("button", { name: "About you, done" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Tell us about you");
    await expect.element(box("First name")).toHaveValue("Alex");
    expect(moves.at(-1)).toEqual({ step: "about", replace: false });
  });

  it("never links past the first unfinished step (5.4b, call 5)", async () => {
    carOnly();
    renderFlow("about");
    const tabs = page.getByRole("navigation", { name: "Your details" });
    await expect.element(tabs.getByRole("button", { name: "Car, done" })).toBeVisible();
    await expect.element(tabs.getByRole("button", { name: /Driving/ })).not.toBeInTheDocument();
    await expect.element(tabs.getByRole("button", { name: /Claims/ })).not.toBeInTheDocument();
    await expect.element(tabs.getByRole("button", { name: /Drivers/ })).not.toBeInTheDocument();
  });

  it("shows the car beside every step, and Change clears it for the car step (5.4b, call 6)", async () => {
    storeComplete();
    const { moves } = renderFlow("driving");
    const card = page.getByRole("region", { name: "Your car" });
    await expect.element(card.getByText("Postcode E8 3RL")).toBeInTheDocument();
    await card.getByRole("button", { name: /Change/ }).click();
    await expect.element(page.getByText("car step")).toBeVisible();
    expect(moves.at(-1)).toEqual({ step: undefined, replace: false });
    expect(readJourney("car")?.vehicle).toBeUndefined();
    expect(readJourney("car")?.usage).toBeDefined();
  });

  it("sends a link to a later step with no car back to the car step", async () => {
    const { moves } = renderFlow("drivers");
    await expect.element(page.getByText("car step")).toBeVisible();
    expect(moves).toEqual([{ step: undefined, replace: true }]);
  });

  it("sends a link past an unfinished step to the first one", async () => {
    carOnly();
    const { moves } = renderFlow("claims");
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Tell us about you");
    expect(moves).toEqual([{ step: "about", replace: true }]);
  });

  it("ends a complete journey on the holding quote view, with each answer summarised", async () => {
    storeComplete();
    renderFlow("drivers");
    await page.getByRole("button", { name: "Get my car quote" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Your quote is ready");
    await expect.element(page.getByText("Total payable £1,063.78")).toBeVisible();
    await expect.element(page.getByText("Alex Morgan, born 12 May 1991")).toBeVisible();
    await expect
      .element(page.getByText("Full UK, 5 years’ no-claims, 8,000 miles a year"))
      .toBeVisible();
    await expect.element(page.getByText("None", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Jamie Morgan")).toBeVisible();
    await expect.element(page.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("sends an edit that breaks a later step to that step, with its error", async () => {
    storeComplete();
    renderFlow("quote");
    await page.getByRole("button", { name: "Edit About you" }).click();
    // Born 1995: the 2010 licence is now before the 17th birthday
    await userEvent.fill(group("Date of birth").getByRole("textbox", { name: "Year" }), "1995");
    await page.getByRole("button", { name: "Continue to your licence" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Your licence and driving");
    await expect
      .element(page.getByText("The licence date can’t be before your 17th birthday."))
      .toBeVisible();
  });

  it("reopens a step that turned invalid since it was saved, with its error", async () => {
    // An incident a day older than the 5-year window: valid when saved, invalid today
    const [y, m, d] = addYears(todayIso(), -5).split("-").map(Number);
    const old = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
    storeComplete((journey) => {
      journey.claims = {
        any: true,
        incidents: [{ id: "i1", date: old, type: "collision", fault: "at_fault", costPounds: 500 }],
        confirmed: true,
      };
    });
    renderFlow("quote");
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Your driving history");
    await expect.element(page.getByText("The incident must be in the last 5 years.")).toBeVisible();
  });

  it("returns to the summary after an edit that breaks nothing", async () => {
    storeComplete();
    renderFlow("quote");
    await page.getByRole("button", { name: "Edit Claims" }).click();
    await page.getByRole("button", { name: "Continue to named drivers" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Your quote is ready");
  });

  it("keeps the answers through a refresh", async () => {
    storeComplete();
    const queryClient = client();
    const moves: Move[] = [];
    const screen = await withQuery(
      <Harness key="1" initial="driving" moves={moves} />,
      queryClient,
    );
    await expect.element(box("Annual mileage")).toHaveValue("8000");
    // A new key mounts the steps afresh, reading the tab's storage again, as a refresh does
    await screen.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness key="2" initial="driving" moves={moves} />
      </QueryClientProvider>,
    );
    await expect.element(box("Annual mileage")).toHaveValue("8000");
    await expect
      .element(select("Use of the car"))
      .toHaveDisplayValue("Social, domestic and commuting");
  });

  it("goes back a step, and from About you to the car", async () => {
    storeComplete();
    const { moves } = renderFlow("about");
    await page.getByRole("button", { name: "Back" }).click();
    await expect.element(page.getByText("car step")).toBeVisible();
    expect(moves.at(-1)).toEqual({ step: undefined, replace: false });
  });

  it("never puts an answer in the URL", async () => {
    storeComplete();
    renderFlow("drivers");
    await page.getByRole("button", { name: "Get my car quote" }).click();
    await expect.element(page.getByText("Total payable £1,063.78")).toBeVisible();
    for (const typed of ["Alex", "Morgan", "Albion", "Jamie"]) {
      expect(window.location.href).not.toContain(typed);
    }
  });

  it("uses the London date", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the price on the holding view (5.4)", () => {
  const moves: { step: QuoteStep | undefined; replace: boolean }[] = [];
  beforeEach(() => {
    moves.length = 0;
  });

  function Harness({ initial }: { initial: QuoteStep }) {
    const [step, setStep] = useState<QuoteStep | undefined>(initial);
    return step ? (
      <DriverSteps
        step={step}
        onStep={(next, opts) => {
          moves.push({ step: next, replace: opts?.replace ?? false });
          setStep(next);
        }}
      />
    ) : (
      <p>car step</p>
    );
  }

  function showQuote() {
    const journey = completeJourney();
    journey.claims = { any: false, incidents: [], confirmed: true };
    journey.lastPlate = "AB12 CDE";
    journey.namedDrivers = {
      any: true,
      drivers: [{ ...journey.namedDrivers!.drivers[0]!, firstName: "Sam" }],
    };
    store(journey);
    return withQuery(<Harness initial="quote" />);
  }

  const heading = () => page.getByRole("heading", { level: 1 });
  // The annual card's total: the price is showing (5.4b, call 10)
  const PRICE = "Total payable £1,063.78";

  it("shows annual and monthly as a choice, annual first, with IPT (5.4b, call 10)", async () => {
    await showQuote();
    await expect.element(heading()).toHaveTextContent("Your quote is ready");
    await expect
      .element(page.getByRole("heading", { name: "Your Comprehensive price" }))
      .toBeVisible();
    const annual = page.getByRole("radio", { name: /Pay annually/ });
    const monthly = page.getByRole("radio", { name: /Pay monthly/ });
    await expect.element(annual).toBeChecked();
    await expect.element(monthly).not.toBeChecked();
    await expect.element(page.getByText("£1,063.78", { exact: true })).toBeVisible();
    await expect.element(page.getByText(PRICE)).toBeVisible();
    await expect.element(page.getByText("£97.51", { exact: true })).toBeVisible();
    // 12 × £97.51 = £1,170.12: what the visitor actually pays monthly
    await expect.element(page.getByText("Total payable £1,170.12")).toBeVisible();
    await expect.element(page.getByText("Premiums include Insurance Premium Tax.")).toBeVisible();
    // The tab's journey went to the server, without the last plate typed
    expect(price).toHaveBeenCalledTimes(1);
    const sent = (price.mock.calls[0]![0] as { data: Journey }).data;
    expect(sent.mainDriver?.firstName).toBe("Alex");
    expect(sent).not.toHaveProperty("lastPlate");
  });

  const REVIEW = "Let’s review your named driver";

  it("shows the review step when a named driver needs checking (5.4b, call 11)", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: 1 });
    await showQuote();
    await expect.element(heading()).toHaveTextContent(REVIEW);
    await expect
      .element(page.getByText("We need to check a couple of things before we can include Sam."))
      .toBeVisible();
    await expect
      .element(page.getByText("We need to check a couple of things about Sam"))
      .toBeVisible();
    await expect.element(page.getByText(PRICE)).not.toBeInTheDocument();
  });

  it("shows the review step when a named driver is declined (5.4b, call 11)", async () => {
    price.mockResolvedValue({ status: "declined", namedDriver: 1 });
    await showQuote();
    await expect.element(heading()).toHaveTextContent(REVIEW);
    await expect
      .element(page.getByText("We can’t offer cover with Sam as a named driver."))
      .toBeVisible();
    await expect.element(page.getByText("We can’t offer cover with Sam included")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "What happens if you remove Sam?" }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "Sam won’t be covered to drive your car. Only continue without them if they don’t need to drive it.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText(PRICE)).not.toBeInTheDocument();
  });

  it("opens Named drivers from Review named driver details", async () => {
    price.mockResolvedValue({ status: "declined", namedDriver: 1 });
    await showQuote();
    await page.getByRole("button", { name: "Review named driver details" }).click();
    await expect.element(heading()).toHaveTextContent("Who else will drive your car?");
    expect(moves.at(-1)).toEqual({ step: "drivers", replace: false });
  });

  it("shows the review for the next driver who stops the quote, keeping Add back for the last one removed", async () => {
    price
      .mockResolvedValueOnce({ status: "declined", namedDriver: 1 })
      .mockResolvedValue({ status: "declined", namedDriver: 1 });
    const journey = completeJourney();
    journey.claims = { any: false, incidents: [], confirmed: true };
    const jamie = journey.namedDrivers!.drivers[0]!;
    journey.namedDrivers = { any: true, drivers: [{ ...jamie, firstName: "Sam" }, jamie] };
    store(journey);
    await withQuery(<Harness initial="quote" />);
    await page.getByRole("button", { name: "Remove Sam and see my price" }).click();
    await expect.element(page.getByText("Sam has been removed from this quote.")).toBeVisible();
    await expect.element(heading()).toHaveTextContent(REVIEW);
    await expect
      .element(page.getByText("We can’t offer cover with Jamie as a named driver."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Add Sam back" })).toBeVisible();
  });

  it("fits a long name at 360px", async () => {
    await page.viewport(360, 800);
    price.mockResolvedValue({ status: "declined", namedDriver: 1 });
    const journey = completeJourney();
    journey.claims = { any: false, incidents: [], confirmed: true };
    journey.namedDrivers = {
      any: true,
      drivers: [{ ...journey.namedDrivers!.drivers[0]!, firstName: "Maximilian-Alexander" }],
    };
    store(journey);
    await withQuery(<Harness initial="quote" />);
    await expect.element(heading()).toHaveTextContent(REVIEW);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
    await page.viewport(414, 896);
  });

  it("shows the plain referral line when no driver is the reason", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await showQuote();
    await expect
      .element(page.getByText("We need to check a couple of things, usually within a day."))
      .toBeVisible();
  });

  it("shows the plain decline line when no driver is the reason", async () => {
    price.mockResolvedValue({ status: "declined", namedDriver: null });
    await showQuote();
    await expect
      .element(page.getByText("We can’t offer car cover for these details."))
      .toBeVisible();
  });

  it("removes the driver who stopped the quote on the spot, and prices again", async () => {
    price.mockResolvedValueOnce({ status: "declined", namedDriver: 1 }).mockResolvedValue(QUOTED);
    await showQuote();
    await expect.element(heading()).toHaveTextContent(REVIEW);
    await page.getByRole("button", { name: "Remove Sam and see my price" }).click();
    // Still on the quote: Sam is gone from the tab's journey and the price is worked out again
    await expect.element(heading()).toHaveTextContent("Your quote is ready");
    await expect.element(page.getByText("Sam has been removed from this quote.")).toBeVisible();
    await expect.element(page.getByText(PRICE)).toBeVisible();
    expect(moves).toEqual([]);
    expect(readJourney("car")!.namedDrivers).toEqual({ any: false, drivers: [] });
    const sent = (price.mock.calls[1]![0] as { data: Journey }).data;
    expect(sent.namedDrivers).toEqual({ any: false, drivers: [] });
    expect(window.location.href).not.toContain("Sam");
  });

  it("puts a removed driver back with Undo, exactly as entered", async () => {
    price
      .mockResolvedValueOnce({ status: "declined", namedDriver: 1 })
      .mockResolvedValueOnce(QUOTED)
      .mockResolvedValue({ status: "declined", namedDriver: 1 });
    await showQuote();
    const before = readJourney("car")!.namedDrivers;
    await page.getByRole("button", { name: "Remove Sam and see my price" }).click();
    await expect.element(page.getByText(PRICE)).toBeVisible();
    await page.getByRole("button", { name: "Add Sam back" }).click();
    await expect.element(heading()).toHaveTextContent(REVIEW);
    await expect.element(page.getByText("We can’t offer cover with Sam included")).toBeVisible();
    await expect
      .element(page.getByText("Sam has been removed from this quote."))
      .not.toBeInTheDocument();
    expect(readJourney("car")!.namedDrivers).toEqual(before);
  });

  it("keeps the other named drivers when one is removed", async () => {
    price.mockResolvedValueOnce({ status: "declined", namedDriver: 2 }).mockResolvedValue(QUOTED);
    const journey = completeJourney();
    journey.claims = { any: false, incidents: [], confirmed: true };
    const jamie = journey.namedDrivers!.drivers[0]!;
    journey.namedDrivers = {
      any: true,
      drivers: [jamie, { ...jamie, id: "d2", firstName: "Sam" }],
    };
    store(journey);
    await withQuery(<Harness initial="quote" />);
    await page.getByRole("button", { name: "Remove Sam and see my price" }).click();
    await expect.element(page.getByText(PRICE)).toBeVisible();
    expect(readJourney("car")!.namedDrivers).toEqual({ any: true, drivers: [jamie] });
  });

  it("sends a step the server finds invalid back to that step, replacing the history entry", async () => {
    // Pushing would trap Back: it would return to the quote, which redirects again
    price.mockResolvedValue({ status: "invalid", step: "driving" });
    await showQuote();
    await expect.element(heading()).toHaveTextContent("Your licence and driving");
    expect(moves).toEqual([{ step: "driving", replace: true }]);
  });

  it("sends an invalid car back to the car step, replacing the history entry", async () => {
    price.mockResolvedValue({ status: "invalid", step: "car" });
    await showQuote();
    await expect.element(page.getByText("car step")).toBeVisible();
    expect(moves).toEqual([{ step: undefined, replace: true }]);
  });

  it("keeps one live region, so the price is announced when it arrives", async () => {
    let resolve!: (value: typeof QUOTED) => void;
    price.mockReturnValue(new Promise((r) => (resolve = r)));
    await showQuote();
    await expect.element(page.getByText("Working out your price…")).toBeVisible();
    const region = document.querySelector('.quote-price[role="status"]');
    expect(region?.textContent).toBe("Working out your price…");
    resolve(QUOTED);
    await expect.element(page.getByText(PRICE)).toBeVisible();
    // The same element, still mounted, now holds the price
    expect(region?.isConnected).toBe(true);
    expect(region?.textContent).toContain(PRICE);
  });

  it("keeps the pay choice through a refresh (5.4b, call 10)", async () => {
    const screen = await showQuote();
    await page.getByText("Pay monthly").click();
    await expect.element(page.getByRole("radio", { name: /Pay monthly/ })).toBeChecked();
    expect(readJourney("car")?.payment).toBe("monthly");
    await screen.unmount();
    await withQuery(<Harness initial="quote" />);
    await expect.element(page.getByRole("radio", { name: /Pay monthly/ })).toBeChecked();
  });

  it("says Choose cover arrives in 5.5 (5.4b, call 10)", async () => {
    await showQuote();
    await page.getByRole("button", { name: "Choose cover" }).click();
    await expect.element(page.getByText("Choosing your cover arrives in 5.5")).toBeVisible();
  });

  it("goes back to Named drivers from Back to your details (5.4b, call 10)", async () => {
    await showQuote();
    await expect.element(page.getByText(PRICE)).toBeVisible();
    await page.getByRole("button", { name: "Back to your details" }).click();
    await expect.element(heading()).toHaveTextContent("Who else will drive your car?");
    expect(moves.at(-1)).toEqual({ step: "drivers", replace: false });
  });

  it("says when too many prices were asked for", async () => {
    price.mockResolvedValue({ status: "rate_limited" });
    await showQuote();
    await expect
      .element(
        page.getByText("You’ve asked for a lot of prices in a short time. Try again in an hour."),
      )
      .toBeVisible();
  });

  it("offers Try again after a failure", async () => {
    price.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(QUOTED);
    await showQuote();
    await expect.element(page.getByText("We couldn’t work out your price just now.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(page.getByText(PRICE)).toBeVisible();
  });
});
