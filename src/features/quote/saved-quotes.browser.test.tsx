import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import type { QuoteItemSummary, SavedQuoteCard } from "#/server/data/quotes";
import { renderWithRouter } from "#/test/router";

import { SavedQuotes } from "./SavedQuotes";

// Your saved quotes (5.6, decision 10; Figma 270:3759): a card per quote, a badge and a button by
// state. One product leads with its kind and its price; a bundle has a panel per product.

const OWNER = { firstName: "Alex", lastName: "Morgan" };
const QUOTE_ID = "0193a0b2-1c3d-7e4f-8a5b-6c7d8e9f0a1b";
const car = {
  make: "Volkswagen",
  model: "Golf",
  variant: "1.0 TSI Life 5dr",
  registration: "KR21 ERB",
};

const carItem: QuoteItemSummary = {
  product: "car",
  car,
  home: null,
  coverLevel: "comprehensive",
  compulsoryExcessPence: 25000,
  voluntaryExcessPence: 0,
  addons: [],
};

const homeItem: QuoteItemSummary = {
  ...carItem,
  product: "home",
  car: null,
  home: {
    addressLine1: "18 Albion Road",
    town: "Hackney",
    postcode: "E8 3RL",
    propertyType: "terraced",
    bedrooms: 3,
  },
};

const card = (over: Partial<SavedQuoteCard>): SavedQuoteCard => ({
  quoteId: QUOTE_ID,
  reference: "KRB-Q-12345",
  state: "ready",
  items: [carItem],
  annualTotalPence: 45840,
  monthlyPaymentPence: 4202,
  policyReferences: [],
  postcode: "E8 3RL",
  ...over,
});

const quoteCard = () => page.getByRole("article", { name: "Quote KRB-Q-12345" });

describe("Your saved quotes", () => {
  it("shows the eyebrow, heading and introduction", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({})]} />);
    await expect.element(page.getByText("Saved quotes · Alex Morgan")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "My quotes", level: 1 })).toBeVisible();
    await expect
      .element(page.getByText("Pick up a quote or find your purchased cover."))
      .toBeVisible();
  });

  it("leaves the name out of the eyebrow when there isn't one", async () => {
    await renderWithRouter(
      <SavedQuotes owner={{ firstName: "", lastName: "" }} cards={[card({})]} />,
    );
    await expect.element(page.getByText("Saved quotes", { exact: true })).toBeVisible();
  });

  it("ready: the product, badge, car, prices, saved-price line and Continue quote", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({})]} />);
    const quote = quoteCard();
    await expect.element(quote.getByText("Car insurance")).toBeVisible();
    await expect.element(quote.getByText("Ready to buy")).toBeVisible();
    await expect
      .element(quote.getByRole("heading", { name: "Volkswagen Golf 1.0 TSI Life 5dr", level: 2 }))
      .toBeVisible();
    await expect.element(quote.getByText("KR21 ERB · Comprehensive")).toBeVisible();
    await expect.element(quote.getByText("Quote KRB-Q-12345")).toBeVisible();
    await expect.element(quote.getByText("£458.40")).toBeVisible();
    await expect.element(quote.getByText("Or 12 payments of £42.02")).toBeVisible();
    await expect.element(quote.getByText("Includes Insurance Premium Tax")).toBeVisible();
    await expect
      .element(
        quote.getByText("Price saved for 30 days from issue, provided your details stay the same."),
      )
      .toBeVisible();
    await expect
      .element(quote.getByRole("link", { name: "Continue quote" }))
      .toHaveAttribute("href", `/quote/pay/${QUOTE_ID}`);
  });

  it("ready without a monthly price or a registration: the annual price and the cover only", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[
          card({
            items: [{ ...carItem, car: { ...car, registration: null } }],
            monthlyPaymentPence: null,
          }),
        ]}
      />,
    );
    await expect.element(quoteCard().getByText("Comprehensive", { exact: true })).toBeVisible();
    await expect.element(quoteCard().getByText("£458.40")).toBeVisible();
    await expect.element(page.getByText(/Or 12 payments/)).not.toBeInTheDocument();
  });

  it("review: badge and copy, and no price or button", async () => {
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
    await expect.element(page.getByText("Includes Insurance Premium Tax")).not.toBeInTheDocument();
    await expect.element(page.getByRole("link")).not.toBeInTheDocument();
  });

  it("bought: the policy reference and Go to my account, with no price", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[card({ state: "bought", policyReferences: ["KRB-482913"] })]}
      />,
    );
    await expect.element(page.getByText("Bought", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Your policy", { exact: true })).toBeVisible();
    await expect.element(page.getByText("KRB-482913")).toBeVisible();
    await expect.element(page.getByText("£458.40")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("link", { name: "Go to my account" }))
      .toHaveAttribute("href", "/account");
  });

  it("expired: the copy and Start a new quote with the postcode, with no price", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[card({ state: "expired" })]} />);
    await expect.element(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "This quote’s saved-price period has ended. Get a new quote with your current details.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("£458.40")).not.toBeInTheDocument();
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

  it("a home card: the address, its town and cover, and a new home quote when it's expired (5.7)", async () => {
    await renderWithRouter(
      <SavedQuotes owner={OWNER} cards={[card({ items: [homeItem], state: "expired" })]} />,
    );
    const quote = quoteCard();
    await expect.element(quote.getByText("Home insurance")).toBeVisible();
    await expect
      .element(quote.getByRole("heading", { name: "18 Albion Road", level: 2 }))
      .toBeVisible();
    await expect.element(quote.getByText("Hackney · Comprehensive")).toBeVisible();
    await expect
      .element(quote.getByRole("link", { name: "Start a new quote" }))
      .toHaveAttribute(
        "href",
        expect.stringMatching(/^\/quote\?type=home&postcode=E8(\+|%20)3RL$/),
      );
  });

  it("lists several quotes, a card each", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[
          card({}),
          card({ quoteId: "q2", reference: "KRB-Q-22222", items: [homeItem], state: "review" }),
        ]}
      />,
    );
    await expect.element(page.getByRole("article", { name: "Quote KRB-Q-12345" })).toBeVisible();
    expect(page.getByRole("article").all()).toHaveLength(2);
    await expect.element(page.getByRole("article", { name: "Quote KRB-Q-22222" })).toBeVisible();
  });
});

describe("a car + home bundle on Your saved quotes (5.7b, decision 8)", () => {
  const bundle = (over: Partial<SavedQuoteCard>) =>
    card({ items: [carItem, homeItem], annualTotalPence: 69_840, ...over });

  it("shows one card with a panel per product, and the combined price in the footer", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[bundle({})]} />);
    const quote = quoteCard();
    await expect
      .element(quote.getByRole("heading", { name: "Car + home bundle", level: 2 }))
      .toBeVisible();
    await expect.element(quote.getByText("Quote KRB-Q-12345")).toBeVisible();
    await expect
      .element(quote.getByRole("heading", { name: "Volkswagen Golf", level: 3 }))
      .toBeVisible();
    await expect.element(quote.getByText("1.0 TSI Life 5dr")).toBeVisible();
    await expect
      .element(quote.getByRole("heading", { name: "18 Albion Road", level: 3 }))
      .toBeVisible();
    await expect.element(quote.getByText("Hackney", { exact: true })).toBeVisible();
    await expect.element(quote.getByText("Car", { exact: true })).toBeVisible();
    await expect.element(quote.getByText("Home", { exact: true })).toBeVisible();
    await expect.element(quote.getByText("Car insurance")).not.toBeInTheDocument();
    await expect.element(quote.getByText("£698.40")).toBeVisible();
    await expect
      .element(quote.getByRole("link", { name: "Continue quote" }))
      .toHaveAttribute("href", `/quote/pay/${QUOTE_ID}`);
  });

  it("shows both policy references once bought", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[bundle({ state: "bought", policyReferences: ["KRB-482913", "KRB-482914"] })]}
      />,
    );
    await expect.element(page.getByText("Your policies")).toBeVisible();
    await expect.element(page.getByText("KRB-482913 and KRB-482914")).toBeVisible();
    await expect.element(page.getByText("£698.40")).not.toBeInTheDocument();
  });

  it("under review: both panels, the copy, and no price or button", async () => {
    await renderWithRouter(
      <SavedQuotes
        owner={OWNER}
        cards={[bundle({ state: "review", annualTotalPence: null, monthlyPaymentPence: null })]}
      />,
    );
    await expect.element(page.getByText("Under review")).toBeVisible();
    expect(page.getByRole("heading", { level: 3 }).all()).toHaveLength(2);
    await expect.element(page.getByRole("link")).not.toBeInTheDocument();
  });

  it("expired: a new car quote, as the journey starts with the car", async () => {
    await renderWithRouter(<SavedQuotes owner={OWNER} cards={[bundle({ state: "expired" })]} />);
    await expect
      .element(page.getByRole("link", { name: "Start a new quote" }))
      .toHaveAttribute("href", expect.stringMatching(/^\/quote\?type=car&postcode=E8(\+|%20)3RL$/));
  });
});
