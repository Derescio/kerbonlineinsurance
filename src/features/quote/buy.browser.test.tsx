import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { getSessionUser } from "#/features/auth/session";
import type { CarPriceResult } from "#/server/quote/price";
import type { SaveCarResult } from "#/server/quote/save";
import { renderWithRouter } from "#/test/router";
import type { WriteResult } from "#/lib/validation";

import { GOLF_PRICES } from "./cover-fixtures";
import { DriverSteps } from "./DriverSteps";
import { completeJourney } from "./journey-fixtures";
import { journeyKey, readJourney, savedQuoteKey, type Journey } from "./journey-store";
import type { QuoteStep } from "./search";
import { priceCar, saveQuoteFn } from "./server";
import { VehicleStep } from "./VehicleStep";

// The gate (5.6, decisions 2, 3, 11 and 13): Buy, Save and exit and the referred screen's button.
// The price, the save and the session are mocked at the server-function boundary, and Better Auth
// at its client: the server's own tests cover them.

vi.mock("./server", () => ({ priceCar: vi.fn(), saveQuoteFn: vi.fn() }));
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn() }));

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  sendVerificationEmail: vi.fn(),
}));
vi.mock("#/features/auth/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/features/auth/auth-client")>()),
  authClient: client,
}));
vi.mock("#/features/auth/Turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (token: string | null) => void }) => (
    <button type="button" onClick={() => onToken("test-token")}>
      Pass robot check
    </button>
  ),
}));

const price = vi.mocked(priceCar);
const save = vi.mocked(saveQuoteFn);
const session = vi.mocked(getSessionUser);

const QUOTED: CarPriceResult = { status: "quoted", ...GOLF_PRICES };
const USER = { id: "u1", name: "Alex Morgan", email: "alex@example.com", emailVerified: true };
const saved = (quoteId: string): WriteResult<SaveCarResult> => ({
  ok: true,
  data: { status: "saved", quoteId, reference: "KRB-Q-12345", outcome: "quoted" },
});

type Move = { step: QuoteStep | undefined; replace: boolean; after?: "retrieve" };
const moves: Move[] = [];

beforeEach(() => {
  moves.length = 0;
  sessionStorage.clear();
  vi.clearAllMocks();
  price.mockResolvedValue(QUOTED);
  session.mockResolvedValue(null);
  save.mockResolvedValue(saved("q-1"));
  client.signUp.email.mockResolvedValue({ data: {}, error: null });
});

/** The route's part: the step and `after` in the URL, the car step, and the start page */
function Harness({ initial, after }: { initial: QuoteStep; after?: "retrieve" }) {
  const [at, setAt] = useState<{ step: QuoteStep | undefined; after?: "retrieve" }>({
    step: initial,
    after,
  });
  const navigate = useNavigate();
  if (!at.step) {
    return (
      <VehicleStep
        view="plate"
        postcode="E8 3RL"
        onView={() => {}}
        onContinue={() => {}}
        onBack={() => {}}
        onTab={() => {}}
      />
    );
  }
  return (
    <DriverSteps
      step={at.step}
      after={at.after}
      onStep={(next, opts) => {
        moves.push({
          step: next,
          replace: opts?.replace ?? false,
          ...(opts?.after && { after: opts.after }),
        });
        setAt({ step: next, after: opts?.after });
      }}
      onRestart={() => void navigate({ href: "/quote?type=car", replace: true })}
    />
  );
}

async function show(
  step: QuoteStep,
  {
    after,
    edit,
    path,
    strict,
  }: { after?: "retrieve"; edit?: (j: Journey) => void; path?: string; strict?: boolean } = {},
) {
  const journey = completeJourney();
  edit?.(journey);
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(journey));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <Harness initial={step} after={after} />
    </QueryClientProvider>
  );
  return renderWithRouter(
    // As src/client.tsx renders the app: effects run, are cleaned up, then run again
    strict ? <StrictMode>{ui}</StrictMode> : ui,
    path ?? `/quote/car?postcode=E8+3RL&step=${step}`,
  );
}

const heading = () => page.getByRole("heading", { level: 1 });
const waiting = () => page.getByRole("region", { name: "Your cover is waiting" });

describe("the gate, for a guest (screens 14 and 15)", () => {
  it("asks them to sign in, and switches to create account with auth=signup", async () => {
    const { router } = await show("buy");
    await expect.element(heading()).toHaveTextContent("Sign in before you pay");
    await expect
      .element(
        page.getByText(
          "We’ll save your quote and selected cover when you sign in. You’ll review your payment details next.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Sign in and continue to payment" }))
      .toBeVisible();
    expect(save).not.toHaveBeenCalled();

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect.poll(() => router.state.location.search).toMatchObject({ auth: "signup" });
    await expect.element(heading()).toHaveTextContent("Create your account to continue");
    await expect
      .element(
        page.getByText(
          "We’ll save your quote and selected cover when you create your account. You’ll review your payment details next.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "New to Kerb?" })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "We only use these details to run your account. Confirm your email after signing up, then return to payment.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  it("goes back to Choose cover", async () => {
    await show("buy");
    await page.getByRole("button", { name: "Back to choose cover" }).click();
    expect(moves.at(-1)).toEqual({ step: "cover", replace: false });
  });

  it("shows the waiting card: the car, the tier, the price for the plan and the total excess", async () => {
    await show("buy", {
      edit: (j) => {
        j.vehicle = { ...j.vehicle!, demoPlate: "KR24 BXL" };
      },
    });
    await expect.element(waiting()).toMatchTextContent(/Volkswagen Golf 1\.0 TSI Life 5dr/);
    await expect.element(waiting()).toMatchTextContent(/KR24 BXL/);
    await expect.element(waiting()).toMatchTextContent(/Comprehensive/);
    await expect.element(waiting()).toMatchTextContent(/£1,063\.78 a year/);
    await expect.element(waiting()).toMatchTextContent(/Total excess £250/);
    await expect
      .element(waiting())
      .toMatchTextContent(/No payment is taken when you sign in or create an account\./);
    await expect.element(page.getByText(/Cover starts/)).not.toBeInTheDocument();
    await expect.element(page.getByText(/Quote saved/)).not.toBeInTheDocument();
  });

  it("shows the monthly price when the tab chose monthly, at the chosen tier and excess", async () => {
    await show("buy", {
      edit: (j) => {
        j.payment = "monthly";
        j.cover = { coverLevel: "plus", voluntaryExcessPence: 0, addons: [] };
      },
    });
    // Plus: 112076 + 13449 IPT = £1,255.25 a year; × 1.1 / 12 = £115.06
    await expect.element(waiting()).toMatchTextContent(/Plus/);
    await expect.element(waiting()).toMatchTextContent(/12 payments of £115\.06/);
    await expect.element(waiting()).toMatchTextContent(/Total excess £150/);
  });

  it("sends the journey with the sign-up, and says the quote is saved to the new account", async () => {
    await show("buy", { path: "/quote/car?postcode=E8+3RL&step=buy&auth=signup" });
    await expect.element(heading()).toHaveTextContent("Create your account to continue");
    await userEvent.fill(page.getByLabelText("Full name"), "Alex Morgan");
    await userEvent.fill(page.getByLabelText("Email address"), "alex@example.com");
    await userEvent.fill(page.getByLabelText("Create a password"), "correct horse battery");
    await userEvent.click(page.getByText("I agree to the terms of use"));
    await page.getByRole("button", { name: "Pass robot check" }).click();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect.element(page.getByText("Check your inbox")).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Your quote is saved to your new account. Confirm your email, sign in, and you’ll find it under Your saved quotes.",
        ),
      )
      .toBeVisible();
    const body = client.signUp.email.mock.calls[0]![0] as { quote?: { journey: Journey } };
    expect(body.quote?.journey.journeyId).toBe(completeJourney().journeyId);
    expect(body.quote?.journey.mainDriver?.firstName).toBe("Alex");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the plate the visitor typed in the tab, out of the sign-up", async () => {
    await show("buy", {
      path: "/quote/car?postcode=E8+3RL&step=buy&auth=signup",
      edit: (j) => {
        j.lastPlate = "AB12 CDE";
      },
    });
    await userEvent.fill(page.getByLabelText("Full name"), "Alex Morgan");
    await userEvent.fill(page.getByLabelText("Email address"), "alex@example.com");
    await userEvent.fill(page.getByLabelText("Create a password"), "correct horse battery");
    await userEvent.click(page.getByText("I agree to the terms of use"));
    await page.getByRole("button", { name: "Pass robot check" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect.element(page.getByText("Check your inbox")).toBeVisible();
    const body = client.signUp.email.mock.calls[0]![0] as { quote?: { journey: Journey } };
    expect(body.quote?.journey).not.toHaveProperty("lastPlate");
  });

  it("an empty journey on Buy goes back to the start", async () => {
    sessionStorage.clear();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { router } = await renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <Harness initial="buy" />
      </QueryClientProvider>,
      "/quote/car?postcode=E8+3RL&step=buy",
    );
    await expect.poll(() => router.state.location.pathname).toBe("/quote");
    expect(router.state.location.search).toEqual({ type: "car" });
    expect(save).not.toHaveBeenCalled();
  });

  it("a quote that isn't quoted any more goes back to Your quote", async () => {
    price.mockResolvedValue({ status: "declined", namedDriver: null });
    await show("buy");
    await expect.poll(() => moves.at(-1)).toEqual({ step: "quote", replace: true });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the gate, signed in (decision 2)", () => {
  beforeEach(() => {
    session.mockResolvedValue(USER);
  });

  it("saves the quote, then goes on to pay", async () => {
    let finish!: (value: WriteResult<SaveCarResult>) => void;
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { router } = await show("buy", { edit: (j) => (j.lastPlate = "AB12 CDE") });
    await expect.element(page.getByRole("status")).toHaveTextContent("Saving your quote…");
    await expect.element(page.getByText("Sign in before you pay")).not.toBeInTheDocument();

    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0]![0] as {
      data: { input: { journey: Journey }; idempotencyKey: string };
    };
    expect(sent.data.input.journey.journeyId).toBe(completeJourney().journeyId);
    expect(sent.data.input.journey).not.toHaveProperty("lastPlate");
    expect(sent.data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    finish(saved("q-1"));
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-1");
    const journey = readJourney("car")!;
    expect(journey.saved).toEqual({ quoteId: "q-1", key: savedQuoteKey(journey) });
  });

  it("under StrictMode, saves once and still goes on to pay", async () => {
    let finish!: (value: WriteResult<SaveCarResult>) => void;
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { router } = await show("buy", { strict: true });
    await expect.element(page.getByRole("status")).toHaveTextContent("Saving your quote…");
    finish(saved("q-1"));
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-1");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Back while saving: the save finishes, but the visitor stays where Back took them", async () => {
    let finish!: (value: WriteResult<SaveCarResult>) => void;
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { router } = await show("buy", { strict: true });
    await expect.element(page.getByRole("status")).toHaveTextContent("Saving your quote…");
    await page.getByRole("button", { name: "Back to choose cover" }).click();
    expect(moves.at(-1)).toEqual({ step: "cover", replace: false });

    finish(saved("q-1"));
    // The quote exists, so it's remembered: Buy again with nothing changed reuses it
    await expect.poll(() => readJourney("car")?.saved?.quoteId).toBe("q-1");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toBe("/quote/car");
    expect(moves.at(-1)).toEqual({ step: "cover", replace: false });
  });

  it("reuses the saved quote when nothing has changed", async () => {
    const { router } = await show("buy", {
      edit: (j) => {
        j.saved = { quoteId: "q-old", key: savedQuoteKey(j) };
      },
    });
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-old");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves again when the cover changed since", async () => {
    const { router } = await show("buy", {
      edit: (j) => {
        j.saved = { quoteId: "q-old", key: savedQuoteKey(j) };
        j.cover = { coverLevel: "essential", voluntaryExcessPence: 0, addons: [] };
      },
    });
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-1");
    expect(save).toHaveBeenCalledTimes(1);
    expect(readJourney("car")!.saved?.quoteId).toBe("q-1");
  });

  it("a withdrawn car goes back to the car step and says so", async () => {
    save.mockResolvedValue({ ok: true, data: { status: "invalid", step: "car" } });
    await show("buy");
    await expect
      .element(page.getByText("This car is no longer available on Kerb. Choose your car again."))
      .toBeVisible();
    expect(moves.at(-1)).toEqual({ step: undefined, replace: true });
    expect(readJourney("car")!.vehicle).toBeUndefined();
  });

  it("a step that no longer passes goes back to that step", async () => {
    save.mockResolvedValue({ ok: true, data: { status: "invalid", step: "claims" } });
    await show("buy");
    await expect.poll(() => moves.at(-1)).toEqual({ step: "claims", replace: true });
  });

  it("shows a refusal, such as a staff account's", async () => {
    save.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "Staff accounts can't buy policies.", fields: {} },
    } as WriteResult<SaveCarResult>);
    const { router } = await show("buy");
    await expect.element(page.getByText("Staff accounts can't buy policies.")).toBeVisible();
    expect(router.state.location.pathname).toBe("/quote/car");
  });
});

describe("Save and exit, and the referred screen's button (decisions 11 and 13)", () => {
  it("Save and exit on Your quote saves the quote and ends on Your saved quotes", async () => {
    session.mockResolvedValue(USER);
    save.mockResolvedValue(saved("q-7"));
    const { router } = await show("quote");
    await expect.element(heading()).toHaveTextContent("Your quote is ready");
    await page.getByRole("button", { name: "Save and exit" }).click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false, after: "retrieve" });
    await expect.poll(() => router.state.location.pathname).toBe("/quote/retrieve");
    expect(readJourney("car")!.saved?.quoteId).toBe("q-7");
  });

  it("Save and exit on Choose cover goes to the gate, bound for Your saved quotes", async () => {
    await show("cover");
    await expect.element(heading()).toHaveTextContent("Compare your cover, side by side");
    await page.getByRole("button", { name: "Save and exit" }).click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false, after: "retrieve" });
    await expect.element(heading()).toHaveTextContent("Sign in before you pay");
    await expect.element(page.getByRole("button", { name: "Back to your quote" })).toBeVisible();
  });

  it("Continue with car only on the home offer goes to the gate", async () => {
    await show("add-home");
    await page.getByRole("button", { name: "Continue with car only" }).click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false });
    await expect.element(heading()).toHaveTextContent("Sign in before you pay");
  });

  it("the referred screen's button goes to the gate, and the saved quote to Your saved quotes", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await show("quote");
    await expect.element(heading()).toHaveTextContent("We need to check a couple of things…");
    await page.getByRole("button", { name: "Sign in to send this for review" }).click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false, after: "retrieve" });
    // A referred quote has no price to wait: the card shows the car alone
    await expect.element(heading()).toHaveTextContent("Sign in before you pay");
    await expect.element(waiting()).toMatchTextContent(/Volkswagen Golf/);
    await expect.element(waiting()).not.toMatchTextContent(/a year/);
  });

  it("a referred quote, signed in, is saved and lands on Your saved quotes", async () => {
    session.mockResolvedValue(USER);
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    save.mockResolvedValue({
      ok: true,
      data: { status: "saved", quoteId: "q-9", reference: "KRB-Q-12345", outcome: "referred" },
    });
    const { router } = await show("buy", {
      after: "retrieve",
      path: "/quote/car?postcode=E8+3RL&step=buy&after=retrieve",
    });
    await expect.poll(() => router.state.location.pathname).toBe("/quote/retrieve");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a referred quote on plain Buy goes back to Your quote", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await show("buy");
    await expect.poll(() => moves.at(-1)).toEqual({ step: "quote", replace: true });
  });
});
