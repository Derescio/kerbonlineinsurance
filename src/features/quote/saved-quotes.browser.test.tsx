import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import type { SavedQuoteCard } from "#/server/data/quotes";
import { renderWithRouter } from "#/test/router";

import { SavedQuotes } from "./SavedQuotes";

// Your saved quotes (5.6, decision 10): a card per quote, a badge and a button by state.

const OWNER = { firstName: "Alex", lastName: "Morgan" };
const QUOTE_ID = "0193a0b2-1c3d-7e4f-8a5b-6c7d8e9f0a1b";
const car = {
  make: "Volkswagen",
  model: "Golf",
  variant: "1.0 TSI Life 5dr",
  registration: "KR21 ERB",
};

const card = (over: Partial<SavedQuoteCard>): SavedQuoteCard => ({
  quoteId: QUOTE_ID,
  reference: "KRB-Q-12345",
  state: "ready",
  car,
  coverLevel: "comprehensive",
  annualTotalPence: 45840,
  monthlyPaymentPence: 4202,
  policyReference: null,
  postcode: "E8 3RL",
  ...over,
});

describe("Your saved quotes", () => {
  it("shows the eyebrow and heading", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({})]} />);
    await expect.element(page.getByText("Saved quotes · Alex Morgan")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Your saved quotes", level: 1 }))
      .toBeVisible();
  });

  it("ready: badge, prices, saved-price line and Continue quote", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({})]} />);
    await expect.element(page.getByText("Ready to buy")).toBeVisible();
    await expect.element(page.getByText("Volkswagen Golf 1.0 TSI Life 5dr")).toBeVisible();
    await expect.element(page.getByText("KR21 ERB · Comprehensive · KRB-Q-12345")).toBeVisible();
    await expect.element(page.getByText("£458.40")).toBeVisible();
    await expect.element(page.getByText("or £42.02 a month", { exact: false })).toBeVisible();
    await expect
      .element(
        page.getByText("Price saved for 30 days from issue, provided your details stay the same."),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Continue quote" }))
      .toHaveAttribute("href", `/quote/pay/${QUOTE_ID}`);
  });

  it("review: badge and copy, and no button", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[card({ state: "review", annualTotalPence: null, monthlyPaymentPence: null })]}
      />,
    );
    await expect.element(page.getByText("Under review")).toBeVisible();
    await expect
      .element(page.getByText("We need to check a couple of things before we can offer cover."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Continue quote" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("link", { name: "Start a new quote" }))
      .not.toBeInTheDocument();
  });

  it("bought: the policy reference and Go to my account", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[card({ state: "bought", policyReference: "KRB-482913" })]}
      />,
    );
    await expect.element(page.getByText("Bought", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Policy KRB-482913")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Go to my account" }))
      .toHaveAttribute("href", "/account");
  });

  it("expired: the copy and Start a new quote with the postcode", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({ state: "expired" })]} />);
    await expect.element(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "This quote’s saved-price period has ended. Get a new quote with your current details.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Start a new quote" }))
      .toHaveAttribute("href", expect.stringMatching(/^\/quote\?type=car&postcode=E8(\+|%20)3RL$/));
  });

  it("empty: the message and Get a quote", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[]} />);
    await expect.element(page.getByText("You don’t have any saved quotes yet.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
  });
});
