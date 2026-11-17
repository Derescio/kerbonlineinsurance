import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { HomePriceResult } from "#/server/quote/price";
import { getSessionUser } from "#/features/auth/session";
import { renderWithRouter } from "#/test/router";

import { GOLF_PRICES } from "./cover-fixtures";
import { demoAddresses } from "./demo-addresses";
import { HomeSteps } from "./HomeSteps";
import { completeHomeJourney } from "./journey-fixtures";
import { journeyKey, readJourney, type Journey } from "./journey-store";
import type { HomeQuoteStep } from "./search";
import { findAddresses, priceHome } from "./server";

// The home steps (5.7, decisions 2–8): About you, Property with the address lookup, Contents and
// security, and Past claims, then Your quote with the outcomes. The lookup and the price are mocked
// at the server-function boundary; the server's own tests cover them.

vi.mock("./server", () => ({
  findAddresses: vi.fn(),
  priceHome: vi.fn(),
  saveHomeQuoteFn: vi.fn(),
}));
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn() }));
// The gate has its own tests
vi.mock("./BuyGate", () => ({ BuyStep: () => <p>The gate</p> }));

const lookup = vi.mocked(findAddresses);
const session = vi.mocked(getSessionUser);
const price = vi.mocked(priceHome);

const QUOTED: HomePriceResult = { status: "quoted", ...GOLF_PRICES, addons: [] };

const moves: { step: HomeQuoteStep | undefined; replace: boolean }[] = [];

function Harness({ initial }: { initial: HomeQuoteStep }) {
  const [step, setStep] = useState<HomeQuoteStep>(initial);
  return (
    <HomeSteps
      step={step}
      postcode="E8 3RL"
      onStep={(next, opts) => {
        moves.push({ step: next, replace: opts?.replace ?? false });
        setStep(next ?? "about");
      }}
      onPostcode={() => {}}
      onOtherProduct={() => {}}
    />
  );
}

function store(journey: Journey) {
  sessionStorage.setItem(journeyKey("home"), JSON.stringify(journey));
}

function empty(): Journey {
  const {
    homeAbout: _a,
    property: _p,
    contents: _c,
    homeClaims: _h,
    ...base
  } = completeHomeJourney();
  return base;
}

async function show(step: HomeQuoteStep, journey: Journey = empty()) {
  store(journey);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <Harness initial={step} />
    </QueryClientProvider>,
    `/quote/home?postcode=E8+3RL&step=${step}`,
  );
}

const heading = () => page.getByRole("heading", { level: 1 });
const group = (name: string) => page.getByRole("group", { name, exact: true });
const box = (name: string) => page.getByRole("textbox", { name, exact: true });
const select = (name: string) => page.getByRole("combobox", { name, exact: true });
const button = (name: string) => page.getByRole("button", { name, exact: true });

async function fillDate(legend: string, day: string, month: string, year: string, nth = 0) {
  const g = group(legend).nth(nth);
  await userEvent.fill(g.getByRole("textbox", { name: "Day" }), day);
  await userEvent.fill(g.getByRole("textbox", { name: "Month" }), month);
  await userEvent.fill(g.getByRole("textbox", { name: "Year" }), year);
}

beforeEach(() => {
  moves.length = 0;
  sessionStorage.clear();
  vi.clearAllMocks();
  lookup.mockImplementation(async ({ data }: { data: { postcode: string } }) => ({
    result: "found",
    addresses: demoAddresses(data.postcode, "Hackney"),
  }));
  price.mockResolvedValue(QUOTED);
  session.mockResolvedValue(null);
});

describe("About you (decision 3)", () => {
  it("takes a name and date of birth, then goes on to the property", async () => {
    await show("about");
    await expect.element(heading()).toHaveTextContent("Tell us about you");
    await userEvent.fill(box("First name"), "Priya");
    await userEvent.fill(box("Last name"), "Shah");
    await fillDate("Date of birth", "2", "3", "1988");
    await button("Continue to property").click();
    await expect.element(heading()).toHaveTextContent("Tell us about your property");
    expect(readJourney("home")?.homeAbout).toEqual({
      firstName: "Priya",
      lastName: "Shah",
      dateOfBirth: "1988-03-02",
    });
  });

  it("keeps the later tabs locked until their step is reached", async () => {
    await show("about");
    const tabs = page.getByRole("navigation", { name: "Your details" });
    await expect.element(tabs.getByText(/Claims$/)).toBeVisible();
    expect(tabs.getByRole("button", { name: /Claims/ }).elements()).toHaveLength(0);
  });
});

describe("Property (decision 4)", () => {
  function upToProperty() {
    const journey = empty();
    journey.homeAbout = completeHomeJourney().homeAbout;
    return journey;
  }

  async function fillBuilding() {
    await userEvent.selectOptions(select("Property type"), "Terraced house");
    await userEvent.fill(box("Year built"), "1985");
    await userEvent.selectOptions(select("Bedrooms"), "3");
    await userEvent.fill(box("Rebuild cost"), "250,000");
  }

  it("lists the addresses for the postcode, and a picked one goes on to contents", async () => {
    await show("property", upToProperty());
    const first = demoAddresses("E8 3RL", "Hackney")[0]!;
    await userEvent.selectOptions(select("Select your address"), `${first.line1}, Hackney`);
    await fillBuilding();
    await button("Continue to contents").click();
    await expect.element(heading()).toHaveTextContent("Your contents and home security");
    expect(readJourney("home")?.property).toMatchObject({
      address: { line1: first.line1, town: "Hackney", picked: true },
      rebuildCostPounds: 250_000,
      bedrooms: 3,
    });
  });

  it("takes an address typed in by hand", async () => {
    await show("property", upToProperty());
    await button("Enter address manually").click();
    await userEvent.fill(box("Address line 1"), "4 Mill Lane");
    await userEvent.fill(box("Town or city"), "Hackney");
    await fillBuilding();
    await button("Continue to contents").click();
    await expect.element(heading()).toHaveTextContent("Your contents and home security");
    expect(readJourney("home")?.property?.address).toEqual({
      line1: "4 Mill Lane",
      town: "Hackney",
      picked: false,
    });
  });

  it("asks for the address again after the postcode changes (Review Focus 3)", async () => {
    await show("property", { ...completeHomeJourney(), homeClaims: undefined });
    await userEvent.fill(box("Postcode"), "M1 1AE");
    await button("Find address").click();
    await expect.element(select("Select your address")).toHaveValue("");
    expect(readJourney("home")?.postcode).toBe("M1 1AE");
    expect(readJourney("home")?.property?.address).toBeUndefined();
    await button("Continue to contents").click();
    await expect
      .element(page.getByText("Choose your address, or enter it manually."))
      .toBeVisible();
  });

  it("drops a picked address when a new postcode isn't found (final review)", async () => {
    await show("property", { ...completeHomeJourney(), homeClaims: undefined });
    lookup.mockResolvedValue({ result: "not_found", addresses: [] });
    await userEvent.fill(box("Postcode"), "ZZ9 9ZZ");
    await button("Find address").click();
    await expect
      .element(page.getByText("We couldn't find that postcode. Check it and try again."))
      .toBeVisible();
    await button("Continue to contents").click();
    await expect
      .element(page.getByText("Choose your address, or enter it manually."))
      .toBeVisible();
    expect(readJourney("home")?.property?.address?.line1).toBe("18 Albion Road");
  });

  it("says when the postcode doesn't exist", async () => {
    lookup.mockResolvedValue({ result: "not_found", addresses: [] });
    await show("property", upToProperty());
    await userEvent.fill(box("Postcode"), "ZZ9 9ZZ");
    await button("Find address").click();
    await expect
      .element(page.getByText("We couldn't find that postcode. Check it and try again."))
      .toBeVisible();
  });
});

describe("Contents and security (decision 5)", () => {
  it("keeps valuables within the contents total", async () => {
    const journey = completeHomeJourney();
    delete journey.contents;
    delete journey.homeClaims;
    await show("contents", journey);
    await userEvent.fill(box("Total contents value"), "5,000");
    await userEvent.fill(box("Valuables total"), "6,000");
    await button("Continue to past claims").click();
    await expect
      .element(
        page.getByText(
          "Valuables are part of your contents, so they can’t be more than the contents total.",
        ),
      )
      .toBeVisible();
  });
});

describe("Past claims (decision 6)", () => {
  function upToClaims() {
    const journey = completeHomeJourney();
    delete journey.homeClaims;
    return journey;
  }

  it("needs a claim on Yes, adds and removes them, and goes on to the quote", async () => {
    await show("claims", upToClaims());
    await expect.element(heading()).toHaveTextContent("Any home claims in the last 5 years?");
    await page.getByText("Yes", { exact: true }).click();
    await button("Add another claim").click();
    expect(page.getByRole("button", { name: /^Remove/ }).elements()).toHaveLength(2);
    await page
      .getByRole("button", { name: /^Remove/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Remove/ })
      .first()
      .click();
    await page.getByText("No", { exact: true }).click();
    await page.getByText("I confirm these details are complete and accurate.").click();
    await button("Get my home quote").click();
    expect(moves.at(-1)).toEqual({ step: "quote", replace: false });
  });

  it("says a Yes needs a claim", async () => {
    await show("claims", upToClaims());
    await page.getByText("Yes", { exact: true }).click();
    await page.getByRole("button", { name: /^Remove/ }).click();
    await page.getByText("I confirm these details are complete and accurate.").click();
    await button("Get my home quote").click();
    await expect.element(page.getByText("Add the claim, or answer no.")).toBeVisible();
  });
});

describe("Your quote (decisions 7 and 8)", () => {
  it("shows the price and the answers at a glance", async () => {
    await show("quote", completeHomeJourney());
    await expect.element(heading()).toHaveTextContent("Your quote is ready");
    await expect.element(page.getByText("Priya Shah, born 2 Mar 1988")).toBeVisible();
    await expect
      .element(page.getByText("18 Albion Road, Terraced house, 3 bedrooms"))
      .toBeVisible();
    await button("Choose cover").click();
    expect(moves.at(-1)).toEqual({ step: "cover", replace: false });
  });

  it("shows the declined screen with a car quote instead", async () => {
    price.mockResolvedValue({ status: "declined", namedDriver: null });
    await show("quote", completeHomeJourney());
    await expect.element(heading()).toHaveTextContent("We’re unable to offer home cover");
    await expect
      .element(page.getByRole("link", { name: "Get a car quote" }))
      .toHaveAttribute("href", expect.stringMatching(/^\/quote\/car\?postcode=E8(\+|%20)3RL$/));
  });

  it("shows screen 03 for a referred quote", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await show("quote", completeHomeJourney());
    await expect.element(heading()).toHaveTextContent("We need to check a couple of things…");
    await expect
      .element(
        page
          .getByRole("region", { name: "What happens next?" })
          .getByText("18 Albion Road, Hackney"),
      )
      .toBeVisible();
  });

  it("asks a guest to sign in to send it for review, and not someone signed in", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await show("quote", completeHomeJourney());
    await expect.element(button("Sign in to send this for review")).toBeVisible();
  });

  it("offers someone signed in to send it for review", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    session.mockResolvedValue({
      id: "u1",
      name: "Priya Shah",
      email: "priya@example.com",
      emailVerified: true,
    });
    await show("quote", completeHomeJourney());
    await expect.element(button("Send this for review")).toBeVisible();
    await button("Send this for review").click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false });
  });

  it("sends a step the server refuses back to it", async () => {
    price.mockResolvedValue({ status: "invalid", step: "contents" });
    await show("quote", completeHomeJourney());
    await expect.poll(() => moves.at(-1)).toEqual({ step: "contents", replace: true });
  });
});
