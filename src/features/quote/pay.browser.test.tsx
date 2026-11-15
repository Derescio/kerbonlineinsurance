import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { WriteResult } from "#/lib/validation";
import type { PaymentSummary, Purchase } from "#/server/data/quotes";
import type { StartCheckoutResult } from "#/server/quote/checkout";
import { renderWithRouter } from "#/test/router";

import { CoveredPage } from "./CoveredPage";
import { completeJourney } from "./journey-fixtures";
import { journeyKey, type Journey } from "./journey-store";
import { PayPage } from "./PayPage";
import { startDateBounds } from "./policy-terms";
import { todayIso } from "./schemas/dates";
import { confirmCheckoutFn, getPurchaseFn, startCheckoutFn } from "./server";

// Confirm and pay, and You're covered (5.6, decisions 6 and 9; 5.6b, decisions 10 and 11). The
// checkout is mocked at the server-function boundary (startCheckout's and fulfilCheckout's own
// tests cover the server), and Stripe's form is a stand-in that shows the secret it was given.

vi.mock("./server", () => ({
  startCheckoutFn: vi.fn(),
  confirmCheckoutFn: vi.fn(),
  getPurchaseFn: vi.fn(),
  priceCar: vi.fn(),
  saveQuoteFn: vi.fn(),
}));
vi.mock("./StripeCheckout", () => ({
  StripeCheckout: ({ clientSecret }: { clientSecret: string }) => (
    <div data-testid="stripe-checkout">{clientSecret}</div>
  ),
}));

const pay = vi.mocked(startCheckoutFn);
const confirm = vi.mocked(confirmCheckoutFn);
const purchaseFn = vi.mocked(getPurchaseFn);

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

const paid: WriteResult<StartCheckoutResult> = {
  ok: true,
  data: { clientSecret: "cs_test_1_secret", checkoutId: "0193a0b2-0000-7000-8000-000000000001" },
};
const refused = (
  message: string,
  fields: Record<string, string> = {},
): WriteResult<StartCheckoutResult> => ({
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
const payButton = () => page.getByRole("button", { name: "Continue to payment" });
const stripeForm = () => page.getByTestId("stripe-checkout");
const TEST_CARDS =
  "Test cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined, 4000 0025 0000 3155 asks for 3-D Secure, 4000 0000 0000 0341 fails on a later month.";
const keyOf = (call: number) =>
  (pay.mock.calls[call]![0] as { data: { idempotencyKey: string } }).data.idempotencyKey;
const secret = (n: number): WriteResult<StartCheckoutResult> => ({
  ok: true,
  data: { clientSecret: `cs_test_${n}_secret`, checkoutId: `c${n}` },
});

async function tickBoth() {
  await page.getByText("I confirm my details are correct", { exact: true }).click();
  await page
    .getByText("I agree to the policy terms and understand my cover", { exact: true })
    .click();
}

describe("Confirm and pay (decision 6)", () => {
  it("shows the heading and the intro", async () => {
    await showPay();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Confirm and pay");
    await expect
      .element(
        page.getByText("Review your payment details, check your cover and complete the purchase."),
      )
      .toBeVisible();
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
    await tickBoth();
    await payButton().click();
    await expect
      .element(page.getByText("Choose a start date from today up to 30 days ahead."))
      .toBeVisible();
    expect(pay).not.toHaveBeenCalled();
  });

  it("needs both boxes ticked", async () => {
    await showPay();
    await payButton().click();
    await expect.element(page.getByText("Confirm your details are correct.")).toBeVisible();
    await expect.element(page.getByText("Agree to the policy terms to continue.")).toBeVisible();
    expect(pay).not.toHaveBeenCalled();
  });

  it("has no card fields of its own: the button is Continue to payment (decision 10)", async () => {
    await showPay();
    await expect.element(payButton()).toBeVisible();
    expect(page.getByLabelText("Card number").elements()).toHaveLength(0);
    expect(page.getByText(/Demo cards/).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /^Pay £/ }).elements()).toHaveLength(0);
  });

  it("shows the plan's payment in the summary", async () => {
    await showPay();
    await expect.element(page.getByText("Annual payment", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: /Pay monthly/ }).click();
    await expect.element(page.getByText("12 payments of £42.02")).toBeVisible();
  });

  it("starts on the plan the tab chose for this quote", async () => {
    storeJourney((j) => {
      j.payment = "monthly";
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    await showPay();
    await expect.element(page.getByText("12 payments of £42.02")).toBeVisible();
  });

  it("validates first: no checkout and no form until the answers are right", async () => {
    await showPay();
    await payButton().click();
    await expect.element(page.getByText("Confirm your details are correct.")).toBeVisible();
    expect(pay).not.toHaveBeenCalled();
    expect(stripeForm().elements()).toHaveLength(0);
    expect(page.getByText(TEST_CARDS).elements()).toHaveLength(0);
  });

  it("starts a checkout for the quote, plan, date and both boxes, then mounts Stripe's form with its secret", async () => {
    await showPay();
    await tickBoth();
    await payButton().click();
    await expect.element(stripeForm()).toHaveTextContent("cs_test_1_secret");
    await expect.element(page.getByText(TEST_CARDS)).toBeVisible();
    expect(pay).toHaveBeenCalledTimes(1);
    const { data } = pay.mock.calls[0]![0] as { data: { input: unknown; idempotencyKey: string } };
    expect(data.input).toEqual({
      quoteId: QUOTE_ID,
      plan: "annual",
      startsOn: startDateBounds(todayIso()).fallback,
      detailsConfirmed: true,
      coverAcknowledged: true,
    });
    expect(data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unmounts the form when the plan, a box or the date changes, and starts a new session after", async () => {
    pay
      .mockResolvedValueOnce(paid)
      .mockResolvedValueOnce(secret(2))
      .mockResolvedValueOnce(secret(3));
    await showPay();
    await tickBoth();
    await payButton().click();
    await expect.element(stripeForm()).toBeVisible();

    // The plan
    await page.getByRole("radio", { name: /Pay monthly/ }).click();
    await expect.poll(() => stripeForm().elements().length).toBe(0);
    expect(page.getByText(TEST_CARDS).elements()).toHaveLength(0);
    await payButton().click();
    await expect.element(stripeForm()).toHaveTextContent("cs_test_2_secret");
    expect(keyOf(1)).not.toBe(keyOf(0));
    expect((pay.mock.calls[1]![0] as { data: { input: { plan: string } } }).data.input.plan).toBe(
      "monthly",
    );

    // A box
    const details = page.getByText("I confirm my details are correct", { exact: true });
    await details.click();
    await expect.poll(() => stripeForm().elements().length).toBe(0);
    await details.click();
    await payButton().click();
    await expect.element(stripeForm()).toHaveTextContent("cs_test_3_secret");
    expect(keyOf(2)).not.toBe(keyOf(1));

    // The date
    await userEvent.fill(field("When should your cover start?"), startDateBounds(todayIso()).min);
    await expect.poll(() => stripeForm().elements().length).toBe(0);
  });

  it("can start again from the button when Stripe's form says its session has expired", async () => {
    pay.mockResolvedValueOnce(paid).mockResolvedValueOnce(secret(2));
    await showPay();
    await tickBoth();
    await payButton().click();
    await expect.element(stripeForm()).toHaveTextContent("cs_test_1_secret");
    // The button stays, and pressing it again starts a new session under a new key
    await payButton().click();
    await expect.element(stripeForm()).toHaveTextContent("cs_test_2_secret");
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("shows a refusal from the server above the button, and no form", async () => {
    pay.mockResolvedValue(refused("Your account is closing, so you can’t buy a policy."));
    await showPay();
    await tickBoth();
    await payButton().click();
    const alert = page.getByText("Your account is closing, so you can’t buy a policy.");
    await expect.element(alert).toBeVisible();
    expect(stripeForm().elements()).toHaveLength(0);
    const order = alert.element().compareDocumentPosition(payButton().element());
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links an already-bought quote to its You're covered page", async () => {
    pay.mockResolvedValue(refused("You’ve already bought this quote."));
    await showPay();
    await tickBoth();
    await payButton().click();
    await expect.element(page.getByText("You’ve already bought this quote.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Go to You’re covered" }))
      .toHaveAttribute("href", `/quote/covered/${QUOTE_ID}`);
  });

  it("can't buy a quote that isn't priced, or one that has expired", async () => {
    const { screen } = await showPay({ ...SUMMARY, status: "referred" });
    await expect.element(page.getByText("This quote can’t be bought online.")).toBeVisible();
    expect(payButton().elements()).toHaveLength(0);
    await screen.unmount();

    await showPay({ ...SUMMARY, expired: true });
    await expect
      .element(page.getByText("This quote has expired. Get a new quote to see today’s price."))
      .toBeVisible();
    expect(payButton().elements()).toHaveLength(0);
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

describe("You're covered (decision 9)", () => {
  it("shows the purchase, the annual payment line and the email line", async () => {
    await renderWithRouter(
      <CoveredPage quoteId={QUOTE_ID} purchase={PURCHASE} />,
      `/quote/covered/${QUOTE_ID}`,
    );
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
        quoteId={QUOTE_ID}
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

describe("You're covered after Stripe's form (5.6b, decision 11)", () => {
  const SESSION = "cs_test_returned";
  // Quick polls for the test; the page's own are every 2 s for 20 s
  const POLL = { everyMs: 20, attempts: 5 };
  const notFound = () => Object.assign(new Error("Not found"), { isNotFound: true });

  async function showReturn() {
    return renderWithRouter(
      <CoveredPage quoteId={QUOTE_ID} purchase={null} sessionId={SESSION} poll={POLL} />,
      `/quote/covered/${QUOTE_ID}?session_id=${SESSION}`,
    );
  }

  it("confirms the session once, then shows the purchase and forgets the tab's journey", async () => {
    storeJourney((j) => {
      j.saved = { quoteId: QUOTE_ID, key: "k" };
    });
    confirm.mockResolvedValue({ status: "fulfilled" });
    purchaseFn.mockResolvedValue(PURCHASE);
    await showReturn();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("You’re covered");
    await expect.element(page.getByText("KRB-482913")).toBeVisible();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ data: { quoteId: QUOTE_ID, sessionId: SESSION } });
    expect(purchaseFn).toHaveBeenCalledWith({ data: { quoteId: QUOTE_ID } });
    expect(sessionStorage.getItem(journeyKey("car"))).toBeNull();
  });

  it("shows an already-fulfilled purchase the same way", async () => {
    confirm.mockResolvedValue({ status: "already" });
    purchaseFn.mockResolvedValue(PURCHASE);
    await showReturn();
    await expect.element(page.getByText("KRB-482913")).toBeVisible();
  });

  it("says it's confirming while the payment is pending, and polls until the policy is there", async () => {
    let answer: (value: { status: "pending" }) => void = () => undefined;
    confirm.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    purchaseFn
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(PURCHASE);
    await showReturn();
    await expect.element(page.getByText("Confirming your payment…")).toBeVisible();
    answer({ status: "pending" });
    await expect.element(page.getByText("KRB-482913")).toBeVisible();
    expect(purchaseFn).toHaveBeenCalledTimes(3);
    expect(page.getByText("Confirming your payment…").elements()).toHaveLength(0);
  });

  it("gives up polling after its time and says the payment is being confirmed", async () => {
    confirm.mockResolvedValue({ status: "unknown" });
    purchaseFn.mockRejectedValue(notFound());
    await showReturn();
    await expect
      .element(
        page.getByText(
          "Your payment is being confirmed. We’ll email you when your policy is ready.",
        ),
      )
      .toBeVisible();
    expect(purchaseFn).toHaveBeenCalledTimes(POLL.attempts);
    await expect
      .element(page.getByRole("link", { name: "Go to my account" }))
      .toHaveAttribute("href", "/account");
  });

  it("says a refunded purchase was refunded, with a link to the saved quotes", async () => {
    confirm.mockResolvedValue({ status: "refunded" });
    await showReturn();
    await expect
      .element(
        page.getByText("We couldn’t complete this purchase, so we’ve refunded your payment."),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Your saved quotes" }))
      .toHaveAttribute("href", "/quote/retrieve");
    expect(purchaseFn).not.toHaveBeenCalled();
    expect(page.getByText("Payment successful").elements()).toHaveLength(0);
  });
});
