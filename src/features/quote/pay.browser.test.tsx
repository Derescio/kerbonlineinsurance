import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { WriteResult } from "#/lib/validation";
import type { PaymentSummary, Purchase } from "#/server/data/quotes";
import type { PayResult } from "#/server/quote/pay";
import { renderWithRouter } from "#/test/router";

import { CoveredPage } from "./CoveredPage";
import { DriverSteps } from "./DriverSteps";
import { completeJourney } from "./journey-fixtures";
import { journeyKey, readJourney, type Journey } from "./journey-store";
import { PayPage } from "./PayPage";
import { startDateBounds } from "./policy-terms";
import { todayIso } from "./schemas/dates";
import { payFn } from "./server";

// Confirm and pay, and You're covered (5.6, decisions 6 and 9). The payment is mocked at the
// server-function boundary: payForQuote's own tests cover the server.

vi.mock("./server", () => ({ payFn: vi.fn(), priceCar: vi.fn(), saveQuoteFn: vi.fn() }));
// The gate (reached by Back after paying) asks for the session; it never gets that far here
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn() }));

const pay = vi.mocked(payFn);

const QUOTE_ID = "0193a0b2-1c3d-7e4f-8a5b-6c7d8e9f0a1b";

const SUMMARY: PaymentSummary = {
  quoteId: QUOTE_ID,
  reference: "KRB-Q-12345",
  status: "priced",
  expired: false,
  policyholder: { firstName: "Alex", lastName: "Morgan" },
  car: { make: "Volkswagen", model: "Golf", variant: "1.0 TSI Life 5dr", registration: "KR21 ERB" },
  coverLevel: "comprehensive",
  compulsoryExcessPence: 25000,
  voluntaryExcessPence: 10000,
  annualTotalPence: 45840,
  monthlyPaymentPence: 4202,
  startDate: "2026-11-12",
  addons: [],
};

const PURCHASE: Purchase = {
  firstName: "Alex",
  email: "alex@example.com",
  plan: "annual",
  card: { brand: "Visa", last4: "4242" },
  firstPaymentPence: 45840,
  monthlyPaymentPence: null,
  policies: [
    {
      reference: "KRB-482913",
      product: "car",
      coverLevel: "comprehensive",
      startsOn: "2026-11-20",
      endsOn: "2027-11-19",
      compulsoryExcessPence: 25000,
      voluntaryExcessPence: 10000,
      car: SUMMARY.car,
    },
  ],
};

const paid: WriteResult<PayResult> = {
  ok: true,
  data: { quoteId: QUOTE_ID, policyReferences: ["KRB-482913"] },
};
const refused = (message: string, fields: Record<string, string> = {}): WriteResult<PayResult> => ({
  ok: false,
  error: { code: "VALIDATION", message, fields },
});

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  pay.mockResolvedValue(paid);
});

function storeJourney(edit?: (journey: Journey) => void) {
  const journey = completeJourney();
  edit?.(journey);
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(journey));
}

async function showPay(summary: PaymentSummary = SUMMARY) {
  return renderWithRouter(<PayPage summary={summary} />, `/quote/pay/${summary.quoteId}`);
}

const field = (name: string) => page.getByLabelText(name, { exact: true });
const payButton = () => page.getByRole("button", { name: /^Pay £/ });

async function fillCard(number = "4242 4242 4242 4242") {
  await userEvent.fill(field("Card number"), number);
  await userEvent.fill(field("Expiry (MM / YY)"), "12 / 30");
  await userEvent.fill(field("Security code"), "123");
}

async function tickBoth() {
  await page.getByText("I confirm my details are correct", { exact: true }).click();
  await page
    .getByText("I agree to the policy terms and understand my cover", { exact: true })
    .click();
}

describe("Confirm and pay (decision 6)", () => {
  it("shows the heading, the intro and the demo cards", async () => {
    await showPay();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Confirm and pay");
    await expect
      .element(
        page.getByText("Review your payment details, check your cover and complete the purchase."),
      )
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Payment card" })).toBeVisible();
    await expect
      .element(
        page.getByText("Demo cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined."),
      )
      .toBeVisible();
    await expect.element(field("Name on card")).toHaveValue("Alex Morgan");
  });

  it("limits the start date to today up to 30 days ahead, and opens on tomorrow", async () => {
    await showPay();
    const bounds = startDateBounds(todayIso());
    const date = field("When should your cover start?");
    await expect.element(date).toHaveAttribute("type", "date");
    await expect.element(date).toHaveAttribute("min", bounds.min);
    await expect.element(date).toHaveAttribute("max", bounds.max);
    await expect.element(date).toHaveValue(bounds.fallback);
  });

  it("refuses a start date past the limit", async () => {
    await showPay();
    const bounds = startDateBounds(todayIso());
    const [y, m, d] = bounds.max.split("-").map(Number);
    const past = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
    await userEvent.fill(field("When should your cover start?"), past);
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect
      .element(page.getByText("Choose a start date from today up to 30 days ahead."))
      .toBeVisible();
    expect(pay).not.toHaveBeenCalled();
  });

  it("shows the card errors on submit", async () => {
    await showPay();
    await userEvent.fill(field("Name on card"), "");
    await userEvent.fill(field("Card number"), "4242 4242 4242 4241");
    await userEvent.fill(field("Expiry (MM / YY)"), "13 / 30");
    await userEvent.fill(field("Security code"), "12");
    await tickBoth();
    await payButton().click();
    await expect.element(page.getByText("Enter the name on the card.")).toBeVisible();
    await expect.element(page.getByText("Enter a valid card number.")).toBeVisible();
    await expect.element(page.getByText("Enter the expiry as MM / YY.")).toBeVisible();
    await expect.element(page.getByText("Enter the 3 or 4 digit security code.")).toBeVisible();
    await expect.element(field("Card number")).toHaveAttribute("aria-invalid", "true");
    expect(pay).not.toHaveBeenCalled();
  });

  it("needs both boxes ticked", async () => {
    await showPay();
    await fillCard();
    await payButton().click();
    await expect.element(page.getByText("Confirm your details are correct.")).toBeVisible();
    await expect.element(page.getByText("Agree to the policy terms to continue.")).toBeVisible();
    expect(pay).not.toHaveBeenCalled();
  });

  it("says the amount on the button: the year, or the first monthly payment", async () => {
    await showPay();
    await expect.element(payButton()).toHaveTextContent("Pay £458.40");
    await page.getByRole("radio", { name: /Pay monthly/ }).click();
    await expect.element(payButton()).toHaveTextContent("Pay £42.02 today");
  });

  it("starts on the plan the tab chose for this quote", async () => {
    storeJourney((j) => {
      j.payment = "monthly";
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    await showPay();
    await expect.element(payButton()).toHaveTextContent("Pay £42.02 today");
  });

  it("sends the quote, plan, date, card and both boxes", async () => {
    await showPay();
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect.poll(() => pay.mock.calls.length).toBe(1);
    const { data } = pay.mock.calls[0]![0] as { data: { input: unknown; idempotencyKey: string } };
    expect(data.input).toEqual({
      quoteId: QUOTE_ID,
      plan: "annual",
      startsOn: startDateBounds(todayIso()).fallback,
      card: { name: "Alex Morgan", number: "4242 4242 4242 4242", expiry: "12 / 30", code: "123" },
      detailsConfirmed: true,
      coverAcknowledged: true,
    });
    expect(data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows a declined card on the card number field", async () => {
    const declined = "Your card was declined. Try another card.";
    pay.mockResolvedValue(refused(declined, { "card.number": declined }));
    await showPay();
    await fillCard("4000 0000 0000 0002");
    await tickBoth();
    await payButton().click();
    await expect.element(page.getByText(declined)).toBeVisible();
    await expect.element(field("Card number")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a refusal from the server under the button", async () => {
    pay.mockResolvedValue(refused("Your account is closing, so you can’t buy a policy."));
    await showPay();
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect
      .element(page.getByText("Your account is closing, so you can’t buy a policy."))
      .toBeVisible();
  });

  it("links an already-bought quote to its You're covered page", async () => {
    pay.mockResolvedValue(refused("You’ve already bought this quote."));
    await showPay();
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect.element(page.getByText("You’ve already bought this quote.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Go to You’re covered" }))
      .toHaveAttribute("href", `/quote/covered/${QUOTE_ID}`);
  });

  it("goes on to You're covered and clears the tab's car journey", async () => {
    storeJourney((j) => {
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    const { router } = await showPay();
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect.poll(() => router.state.location.pathname).toBe(`/quote/covered/${QUOTE_ID}`);
    expect(readJourney("car")).toBeNull();
  });

  it("can't buy a quote that isn't priced, or one that has expired", async () => {
    const { screen } = await showPay({ ...SUMMARY, status: "referred" });
    await expect.element(page.getByText("This quote can’t be bought online.")).toBeVisible();
    expect(page.getByRole("button", { name: /^Pay £/ }).elements()).toHaveLength(0);
    await screen.unmount();

    await showPay({ ...SUMMARY, expired: true });
    await expect
      .element(page.getByText("This quote has expired. Get a new quote to see today’s price."))
      .toBeVisible();
    expect(page.getByRole("button", { name: /^Pay £/ }).elements()).toHaveLength(0);
  });

  it("goes back to Choose cover when the tab holds this quote, and to the saved quotes if not", async () => {
    storeJourney((j) => {
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    const first = await showPay();
    await page.getByRole("button", { name: "Back to choose cover" }).click();
    await expect.poll(() => first.router.state.location.pathname).toBe("/quote/car");
    expect(first.router.state.location.search).toMatchObject({ postcode: "E8 3RL", step: "cover" });
    await first.screen.unmount();

    sessionStorage.clear();
    const second = await showPay();
    await page.getByRole("button", { name: "Back to choose cover" }).click();
    await expect.poll(() => second.router.state.location.pathname).toBe("/quote/retrieve");
  });
});

describe("after paying, Back to the gate (Review Focus 3)", () => {
  function Gate() {
    const navigate = useNavigate();
    return (
      <DriverSteps
        step="buy"
        onStep={() => {}}
        onRestart={() => void navigate({ href: "/quote?type=car", replace: true })}
      />
    );
  }

  it("finds the car journey empty and starts again, never saving an empty journey", async () => {
    storeJourney((j) => {
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    const paying = await showPay();
    await fillCard();
    await tickBoth();
    await payButton().click();
    await expect
      .poll(() => paying.router.state.location.pathname)
      .toBe(`/quote/covered/${QUOTE_ID}`);
    expect(sessionStorage.getItem(journeyKey("car"))).toBeNull();
    await paying.screen.unmount();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { router } = await renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <Gate />
      </QueryClientProvider>,
      "/quote/car?postcode=E8+3RL&step=buy",
    );
    await expect.poll(() => router.state.location.pathname).toBe("/quote");
    expect(router.state.location.search).toEqual({ type: "car" });
  });
});

describe("You're covered (decision 9)", () => {
  it("shows the purchase, the annual payment line and the email line", async () => {
    await renderWithRouter(<CoveredPage purchase={PURCHASE} />, `/quote/covered/${QUOTE_ID}`);
    await expect.element(page.getByText("Payment successful")).toBeVisible();
    await expect.element(page.getByText("Car insurance · Purchase complete")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("You’re covered");
    await expect
      .element(page.getByText("Thanks, Alex. Your comprehensive car insurance is confirmed."))
      .toBeVisible();
    await expect.element(page.getByText("KRB-482913")).toBeVisible();
    await expect.element(page.getByText("£458.40 paid annually · Visa ending 4242")).toBeVisible();
    await expect
      .element(
        page.getByText(
          "A confirmation has been sent to alex@example.com. You can also see your policy in your account.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Go to my account" }))
      .toHaveAttribute("href", "/account");
    expect(page.getByText(/policy documents/i).elements()).toHaveLength(0);
    expect(page.getByRole("link", { name: "View policy" }).elements()).toHaveLength(0);
  });

  it("shows the monthly payment line", async () => {
    await renderWithRouter(
      <CoveredPage
        purchase={{
          ...PURCHASE,
          plan: "monthly",
          firstPaymentPence: 4202,
          monthlyPaymentPence: 4202,
        }}
      />,
      `/quote/covered/${QUOTE_ID}`,
    );
    await expect
      .element(
        page.getByText("£42.02 paid today, then 11 monthly payments of £42.02 · Visa ending 4242"),
      )
      .toBeVisible();
  });
});
