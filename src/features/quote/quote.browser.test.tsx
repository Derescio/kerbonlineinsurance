import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { renderWithRouter } from "#/test/router";

import { ComingSoon } from "./ComingSoon";
import { readJourney } from "./journey-store";
import { JourneyShell } from "./JourneyShell";
import { postcodeError } from "./postcode";
import { QuoteStart } from "./QuoteStart";
import { typeError } from "./search";
import { startQuote } from "./server";

vi.mock("./server", () => ({ startQuote: vi.fn(async () => ({ recorded: true })) }));

const linkHint = "Added from your link. You can change it here.";

describe("QuoteStart (screen 01)", () => {
  it("lists the seven types in screen order with their badges", async () => {
    await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    const radios = page.getByRole("radio").all();
    const names = ["Car", "Home", "Landlord", "Pet", "Condo", "Business", "Tenant"];
    expect(radios).toHaveLength(7);
    for (const [i, name] of names.entries()) {
      await expect.element(radios[i]!).toHaveAccessibleName(name);
      await expect
        .element(radios[i]!)
        .toHaveAccessibleDescription(i < 2 ? "Available now" : "Coming soon");
      await expect.element(radios[i]!).not.toBeChecked();
    }
    await expect.element(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  });

  it("picks the type from the link, and the button follows the choice", async () => {
    await renderWithRouter(<QuoteStart search={{ type: "home" }} />, "/quote");
    const home = page.getByRole("radio", { name: "Home" });
    await expect.element(home).toBeChecked();
    await expect.element(page.getByRole("button", { name: "Continue with home" })).toBeVisible();

    await page.getByText("Home", { exact: true }).click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("radio", { name: "Landlord" })).toBeChecked();
    await expect.element(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect.element(page.getByRole("radio", { name: "Car" })).toBeChecked();
    await expect.element(page.getByRole("button", { name: "Continue with car" })).toBeVisible();
  });

  it("says when the postcode came from the link, until it's changed", async () => {
    await renderWithRouter(<QuoteStart search={{ postcode: "E8 3RL" }} />, "/quote");
    const field = page.getByRole("textbox", { name: "Your postcode" });
    await expect.element(field).toHaveValue("E8 3RL");
    await expect.element(field).toHaveAccessibleDescription(linkHint);
    await userEvent.type(field, "X");
    await expect.element(field).not.toHaveAccessibleDescription(linkHint);
  });

  it("has no link hint without a postcode in the link", async () => {
    await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    await expect.element(page.getByText(linkHint)).not.toBeInTheDocument();
  });

  it("blocks a bad postcode for car, explains and focuses the field", async () => {
    const { router } = await renderWithRouter(<QuoteStart search={{ type: "car" }} />, "/quote");
    const field = page.getByRole("textbox", { name: "Your postcode" });
    await field.fill("E8");
    await page.getByRole("button", { name: "Continue with car" }).click();
    await expect.element(field).toHaveAccessibleDescription(postcodeError);
    await expect.element(field).toHaveFocus();
    expect(router.state.location.pathname).toBe("/quote");
  });

  it("continues to the car journey with the tidy postcode", async () => {
    const { router } = await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    await page.getByText("Car", { exact: true }).click();
    await page.getByRole("textbox", { name: "Your postcode" }).fill("e83rl");
    await page.getByRole("button", { name: "Continue with car" }).click();
    await expect.poll(() => router.state.location.pathname).toBe("/quote/car");
    expect(router.state.location.search).toEqual({ postcode: "E8 3RL" });
  });

  it("sends a coming-soon type on without a postcode", async () => {
    const { router } = await renderWithRouter(<QuoteStart search={{ type: "pet" }} />, "/quote");
    await expect.element(page.getByText("(optional)")).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => router.state.location.pathname).toBe("/quote/coming-soon");
    expect(router.state.location.search).toEqual({ type: "pet" });
  });

  it("asks for a type when none is picked", async () => {
    const { router } = await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect
      .element(page.getByRole("group", { name: "What would you like to insure?" }))
      .toHaveAccessibleDescription(typeError);
    await expect.element(page.getByRole("radio", { name: "Car" })).toHaveFocus();
    expect(router.state.location.pathname).toBe("/quote");
  });

  it("shows a no-JS submit's error on first paint, next to what was typed", async () => {
    await renderWithRouter(
      <QuoteStart search={{ type: "car", postcode: "zz", next: 1 }} />,
      "/quote",
    );
    const field = page.getByRole("textbox", { name: "Your postcode" });
    await expect.element(field).toHaveValue("zz");
    await expect.element(field).toHaveAccessibleDescription(postcodeError);
  });

  it("is a GET form to /quote that works without JavaScript", async () => {
    const { screen } = await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    const form = screen.container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/quote");
    expect(new FormData(form).get("next")).toBe("1");
    await expect.element(page.getByRole("radio", { name: "Car" })).toHaveAttribute("name", "type");
    await expect
      .element(page.getByRole("textbox", { name: "Your postcode" }))
      .toHaveAttribute("name", "postcode");
  });

  it("links to the saved quotes", async () => {
    await renderWithRouter(<QuoteStart search={{}} />, "/quote");
    await expect
      .element(page.getByRole("link", { name: "Retrieve a saved quote" }))
      .toHaveAttribute("href", "/quote/retrieve");
  });
});

const searchOf = (href: string | null) => new URL(href ?? "", location.origin).searchParams;

describe("ComingSoon (screen 02)", () => {
  it("offers car and home, keeping the postcode", async () => {
    await renderWithRouter(
      <ComingSoon search={{ type: "landlord", postcode: "E8 3RL" }} />,
      "/quote/coming-soon",
    );
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("More ways to cover your world");
    const car = page.getByRole("link", { name: "Get a car quote" }).element();
    expect(new URL(car.getAttribute("href")!, location.origin).pathname).toBe("/quote/car");
    expect(searchOf(car.getAttribute("href")).get("postcode")).toBe("E8 3RL");
    const home = page.getByRole("link", { name: "Get a home quote" }).element();
    expect(new URL(home.getAttribute("href")!, location.origin).pathname).toBe("/quote/home");
    await expect
      .element(page.getByText("Your postcode, E8 3RL, will be kept if you choose car or home."))
      .toBeVisible();
    await expect.element(page.getByText("Landlord (your choice)")).toBeInTheDocument();
    await expect
      .element(page.getByText(/^Landlord, pet, condo, business and tenant insurance are/))
      .toBeVisible();
  });

  it("without a postcode, sends car and home to the start with the type picked", async () => {
    await renderWithRouter(<ComingSoon search={{ type: "pet" }} />, "/quote/coming-soon");
    const car = page.getByRole("link", { name: "Get a car quote" }).element();
    expect(new URL(car.getAttribute("href")!, location.origin).pathname).toBe("/quote");
    expect(searchOf(car.getAttribute("href")).get("type")).toBe("car");
    await expect.element(page.getByText(/will be kept if you choose/)).not.toBeInTheDocument();
  });
});

describe("JourneyShell", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(startQuote).mockClear();
    vi.mocked(startQuote).mockImplementation(async () => ({ recorded: true }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await page.viewport(414, 896);
  });

  it("shows the bar Stepper on a phone and the full one wider, at the first step", async () => {
    await page.viewport(390, 800);
    await renderWithRouter(<JourneyShell product="car" postcode="E8 3RL" />, "/quote/car");
    await expect
      .element(page.getByRole("progressbar", { name: "Quote progress" }))
      .toHaveAttribute("aria-valuetext", "Step 1 of 4: Your details");
    await expect
      .element(page.getByRole("navigation", { name: "Quote progress" }))
      .not.toBeInTheDocument();

    await page.viewport(1024, 800);
    const progress = page.getByRole("navigation", { name: "Quote progress" });
    await expect.element(progress).toBeVisible();
    await expect
      .element(progress.getByRole("listitem").filter({ hasText: "Your details" }))
      .toHaveAttribute("aria-current", "step");
    await expect.element(page.getByText("This step arrives in 5.2")).toBeVisible();
    await expect.element(page.getByText(/Postcode: E8 3RL/)).toBeVisible();
    await expect
      .element(page.getByRole("progressbar", { name: "Quote progress" }))
      .not.toBeInTheDocument();
  });

  it("records quote.started once per journey", async () => {
    const first = await renderWithRouter(
      <JourneyShell product="car" postcode="E8 3RL" />,
      "/quote/car",
    );
    await expect.poll(() => readJourney("car")?.startRecorded).toBe(true);
    expect(startQuote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startQuote).mock.calls[0]![0]).toEqual({
      data: {
        product: "car",
        district: "E8",
        journeyId: readJourney("car")!.journeyId,
        anonymousId: null,
      },
    });
    await first.screen.unmount();
    await renderWithRouter(<JourneyShell product="car" postcode="E8 3RL" />, "/quote/car");
    await expect.element(page.getByText("This step arrives in 5.2")).toBeVisible();
    expect(startQuote).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when recording fails", async () => {
    vi.mocked(startQuote).mockRejectedValue(new Error("RATE_LIMITED"));
    await renderWithRouter(<JourneyShell product="home" postcode="N1 9GU" />, "/quote/home");
    await expect.element(page.getByText("This step arrives in 5.7")).toBeVisible();
    await expect.poll(() => vi.mocked(startQuote).mock.calls.length).toBe(1);
    expect(readJourney("home")?.startRecorded).toBe(false);
  });

  it("still works when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await renderWithRouter(<JourneyShell product="car" postcode="E8 3RL" />, "/quote/car");
    await expect.element(page.getByText("This step arrives in 5.2")).toBeVisible();
    await expect.poll(() => vi.mocked(startQuote).mock.calls.length).toBe(1);
  });
});
