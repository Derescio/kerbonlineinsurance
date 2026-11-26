import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { homeDetail, policyDetail } from "#/features/account/policy-detail.fixtures";
import { PolicyDetailPage } from "#/features/account/PolicyDetailPage";
import type { PolicyDetail } from "#/server/data/policies";
import { renderWithRouter } from "#/test/router";

// "Make a change" on the policy page (6.3b; Figma 183:3502 and dialogs 183:3955, 183:4072,
// 183:4168), against mocked server functions. Stripe's form is a stand-in.

const fns = vi.hoisted(() => ({
  priceMyPolicyChangeFn: vi.fn(),
  confirmMyPolicyChangeFn: vi.fn(),
  abandonMyPolicyChangeFn: vi.fn(),
  checkMyTopUpFn: vi.fn(),
}));
vi.mock("./server", () => fns);

const quote = vi.hoisted(() => ({ findAddresses: vi.fn() }));
vi.mock("#/features/quote/server", () => quote);

vi.mock("#/features/quote/StripeCheckout", () => ({
  StripeCheckout: ({ clientSecret }: { clientSecret: string }) => (
    <p>Stripe form for {clientSecret}</p>
  ),
}));

const today = "2026-11-20";
const changeable = (over: Partial<PolicyDetail> = {}) =>
  policyDetail({ changes: { eligible: true, latest: null }, ...over });

const priced = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    status: "priced",
    changeId: "c1",
    priceLine: "Your price goes up by £4.60 a month",
    settlement: "instalments",
    amountPence: 460,
    homeWarning: null,
    levels: [],
    addons: [],
    ...over,
  },
});

/** The catalogue the picker reads (GET /api/catalogue): the Golf insured, a demo plate's Tesla */
const GOLF_ID = "0190f3a2-6c1e-7b1a-9d2e-4f5a6b7c8d9e";
const TESLA_ID = "0190f3a2-6c1e-7b1a-9d2e-4f5a6b7c8d00";
const CARS = [
  {
    id: GOLF_ID,
    make: "Volkswagen",
    model: "Golf",
    year: 2021,
    variant: "1.5 TSI Life",
    fuelType: "petrol",
    doors: 5,
    transmission: "manual",
  },
  {
    id: TESLA_ID,
    make: "Tesla",
    model: "Model 3",
    year: 2024,
    variant: "RWD",
    fuelType: "electric",
    doors: 4,
    transmission: "automatic",
  },
];

async function show(detail: PolicyDetail = changeable()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["catalogue"], { cars: CARS });
  return renderWithRouter(
    <QueryClientProvider client={client}>
      <PolicyDetailPage policy={detail} today={today} />
    </QueryClientProvider>,
    "/account/policies/KRB-818784",
  );
}

const dialog = () => page.getByRole("dialog");
const confirmButton = () => dialog().getByRole("button", { name: "Confirm change" });

async function fillDate(legend: string, day: string, month: string, year: string) {
  const group = dialog().getByRole("group", { name: legend, exact: true });
  await userEvent.fill(group.getByRole("textbox", { name: "Day" }), day);
  await userEvent.fill(group.getByRole("textbox", { name: "Month" }), month);
  await userEvent.fill(group.getByRole("textbox", { name: "Year" }), year);
}

async function fillDriver() {
  await userEvent.click(page.getByRole("button", { name: /Add a driver/ }));
  await userEvent.fill(dialog().getByRole("textbox", { name: "First name" }), "Arjun");
  await userEvent.fill(dialog().getByRole("textbox", { name: "Last name" }), "Patel");
  await fillDate("Date of birth", "2", "11", "1989");
  await userEvent.selectOptions(
    dialog().getByRole("combobox", { name: "Relationship to you" }),
    "partner",
  );
  await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Licence" }), "full_uk");
  await fillDate("Full licence since", "1", "6", "2015");
  await userEvent.selectOptions(
    dialog().getByRole("combobox", { name: "Employment status" }),
    "retired",
  );
}

beforeEach(() => {
  for (const fn of Object.values(fns)) fn.mockReset();
  quote.findAddresses.mockReset();
  fns.priceMyPolicyChangeFn.mockResolvedValue(priced());
});

describe("Make a change", () => {
  it("shows three changes on a car policy that can change, and none on a home or a lapsed one", async () => {
    await show();
    const section = page.getByRole("region", { name: "Make a change" });
    for (const name of [/Add a driver/, /Change address/, /Change cover/]) {
      await expect.element(section.getByRole("button", { name })).toBeVisible();
    }
    await expect.element(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  });

  it("isn't there when the policy can't be changed online", async () => {
    await show(homeDetail());
    await expect.element(page.getByText("Make a change")).not.toBeInTheDocument();
    await show(policyDetail({ status: "lapsed" }));
    await expect
      .element(page.getByRole("button", { name: "Add", exact: true }))
      .not.toBeInTheDocument();
  });
});

describe("Add a driver", () => {
  it("prices the driver once the form is whole, and confirms", async () => {
    fns.confirmMyPolicyChangeFn.mockResolvedValue({ ok: true, data: { status: "applied" } });
    await show();
    await fillDriver();
    await expect.element(dialog().getByText("Your price goes up by £4.60 a month")).toBeVisible();
    await expect
      .element(dialog().getByText("The change applies from today. There's no admin fee."))
      .toBeVisible();
    expect(fns.priceMyPolicyChangeFn).toHaveBeenLastCalledWith({
      data: {
        input: {
          reference: "KRB-818784",
          change: {
            kind: "driver_added",
            driver: expect.objectContaining({
              firstName: "Arjun",
              dateOfBirth: "1989-11-02",
              licenceDate: "2015-06-01",
              noClaimsConfirmed: true,
            }),
          },
        },
      },
    });
    await userEvent.click(confirmButton());
    await expect.element(page.getByText("Your policy's been updated")).toBeVisible();
    expect(fns.confirmMyPolicyChangeFn.mock.calls[0]![0].data.input).toEqual({ changeId: "c1" });
  });

  it("says a driver with claims or convictions isn't added online, with no Confirm", async () => {
    await show();
    await fillDriver();
    // The box is styled over a hidden input, so click its label as a person would
    await userEvent.click(
      dialog().getByText("They've had no claims or convictions in the last 5 years"),
    );
    await expect
      .element(
        dialog().getByText("We can't add a driver with recent claims or convictions online."),
      )
      .toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();
  });
});

describe("Remove a driver", () => {
  it("offers Remove on a named driver only, and names them in the dialog", async () => {
    await show();
    await expect
      .element(page.getByRole("button", { name: "Remove Maya Patel" }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Remove Dev Patel" }));
    await expect
      .element(dialog().getByRole("heading", { name: "Remove Dev Patel from your policy?" }))
      .toBeVisible();
    await expect.element(dialog().getByRole("button", { name: "Remove driver" })).toBeEnabled();
    expect(fns.priceMyPolicyChangeFn.mock.calls.at(-1)![0].data.input.change).toEqual({
      kind: "driver_removed",
      driverId: "d-dev",
    });
  });
});

describe("Change cover", () => {
  it("shows every level with its price line, the current one chosen, and a referred one not online", async () => {
    fns.priceMyPolicyChangeFn.mockResolvedValue(
      priced({
        priceLine: "Your price stays the same",
        levels: [
          {
            coverLevel: "essential",
            available: true,
            priceLine: "Your price goes down by £3.10 a month",
          },
          { coverLevel: "comprehensive", available: true, priceLine: "Your price stays the same" },
          { coverLevel: "plus", available: false, priceLine: null },
        ],
        addons: [{ addon: "breakdown_uk", annualPricePence: 4_500 }],
      }),
    );
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change cover/ }));
    const group = dialog().getByRole("radiogroup", { name: "Choose your cover" });
    await expect.element(group.getByRole("radio", { name: /Comprehensive/ })).toBeChecked();
    await expect.element(group.getByText("Your price goes down by £3.10 a month")).toBeVisible();
    await expect.element(group.getByText("Not available online")).toBeVisible();
    await expect
      .element(dialog().getByRole("combobox", { name: "Voluntary excess" }))
      .toBeVisible();
  });
});

describe("Change cover, while it re-prices", () => {
  const options = {
    levels: [
      {
        coverLevel: "essential",
        available: true,
        priceLine: "Your price goes down by £3.10 a month",
      },
      { coverLevel: "comprehensive", available: true, priceLine: "Your price stays the same" },
      { coverLevel: "plus", available: true, priceLine: "Your price goes up by £6.00 a month" },
    ],
    addons: [
      { addon: "breakdown_uk", annualPricePence: 4_500 },
      { addon: "motor_legal", annualPricePence: 2_500 },
    ],
  };

  it("has no Confirm while nothing has changed", async () => {
    fns.priceMyPolicyChangeFn.mockResolvedValue({
      ok: true,
      data: { status: "unchanged", ...options },
    });
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change cover/ }));
    await expect.element(dialog().getByText("Your price goes up by £6.00 a month")).toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();
  });

  it("keeps every add-on on screen while the next price is worked out", async () => {
    fns.priceMyPolicyChangeFn
      .mockResolvedValueOnce({ ok: true, data: { status: "unchanged", ...options } })
      .mockReturnValue(new Promise(() => undefined));
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change cover/ }));
    const legal = dialog().getByRole("checkbox", { name: /Legal/i });
    await expect.element(legal).toBeVisible();
    await userEvent.click(dialog().getByText(/Legal/i).first());
    await expect.element(dialog().getByText("Working out your price…")).toBeVisible();
    await expect.element(legal).toBeChecked();
  });
});

describe("A change waiting for payment", () => {
  const waiting = () =>
    changeable({
      changes: {
        eligible: true,
        latest: { id: "c7", status: "awaiting_payment", failureReason: null },
      },
    });

  it("checks with Stripe on load, and says nothing about paying when it's paid", async () => {
    fns.checkMyTopUpFn.mockResolvedValue({ status: "applied" });
    await show(waiting());
    await expect.poll(() => fns.checkMyTopUpFn.mock.calls.length).toBe(1);
    expect(fns.checkMyTopUpFn).toHaveBeenCalledWith({ data: { changeId: "c7" } });
    await expect
      .element(page.getByText("You started a change and haven't paid for it yet."))
      .not.toBeInTheDocument();
  });

  it("offers to cancel it", async () => {
    fns.checkMyTopUpFn.mockResolvedValue({ status: "awaiting_payment" });
    fns.abandonMyPolicyChangeFn.mockResolvedValue({ ok: true, data: { status: "abandoned" } });
    await show(
      changeable({
        changes: {
          eligible: true,
          latest: { id: "c7", status: "awaiting_payment", failureReason: null },
        },
      }),
    );
    await expect
      .element(page.getByText("You started a change and haven't paid for it yet."))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancel this change" }));
    expect(fns.abandonMyPolicyChangeFn).toHaveBeenCalledWith({
      data: { input: { changeId: "c7" } },
    });
  });
});

describe("Change address", () => {
  it("warns that home insurance keeps its own address", async () => {
    quote.findAddresses.mockResolvedValue({
      result: "found",
      addresses: [{ id: "a1", line1: "12 Albion Road", town: "London" }],
    });
    fns.priceMyPolicyChangeFn.mockResolvedValue(
      priced({
        homeWarning: "Your home insurance isn't changed. It still covers 11 Rosebery Gardens.",
      }),
    );
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change address/ }));
    await userEvent.fill(dialog().getByRole("textbox", { name: "New postcode" }), "N16 7HB");
    await userEvent.click(dialog().getByRole("button", { name: "Find address" }));
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Address" }), "a1");
    await userEvent.selectOptions(
      dialog().getByRole("combobox", { name: "Where is the car parked overnight?" }),
      "street",
    );
    await expect
      .element(
        dialog().getByText(
          "Your home insurance isn't changed. It still covers 11 Rosebery Gardens.",
        ),
      )
      .toBeVisible();
  });
});

describe("Confirming", () => {
  it("says a refused change can't be made online, with no Confirm", async () => {
    fns.priceMyPolicyChangeFn.mockResolvedValue({
      ok: true,
      data: { status: "refused", message: "We can't make this change online." },
    });
    await show();
    await userEvent.click(page.getByRole("button", { name: "Remove Dev Patel" }));
    await expect.element(dialog().getByText("We can't make this change online.")).toBeVisible();
    await expect.element(dialog().getByRole("button", { name: "Remove driver" })).toBeDisabled();
  });

  it("shows Stripe's form for an annual top-up", async () => {
    fns.priceMyPolicyChangeFn.mockResolvedValue(
      priced({ priceLine: "You'll pay £38.40 now for the rest of the year", settlement: "charge" }),
    );
    fns.confirmMyPolicyChangeFn.mockResolvedValue({
      ok: true,
      data: { status: "pay", clientSecret: "cs_1_secret" },
    });
    await show(changeable({ plan: { kind: "annual" } }));
    await userEvent.click(page.getByRole("button", { name: "Remove Dev Patel" }));
    await userEvent.click(dialog().getByRole("button", { name: "Remove driver" }));
    await expect.element(dialog().getByText("Stripe form for cs_1_secret")).toBeVisible();
  });

  it("shows the new price when it changed before Confirm", async () => {
    fns.confirmMyPolicyChangeFn.mockResolvedValue({
      ok: true,
      data: {
        status: "refused",
        message: "The price has changed",
        priceLine: "Your price goes up by £5.10 a month",
      },
    });
    await show();
    await userEvent.click(page.getByRole("button", { name: "Remove Dev Patel" }));
    await userEvent.click(dialog().getByRole("button", { name: "Remove driver" }));
    await expect
      .element(dialog().getByText("The price has changed. Your price goes up by £5.10 a month."))
      .toBeVisible();
  });

  it("tells them a top-up was refunded when the policy changed while they paid", async () => {
    await renderWithRouter(
      <QueryClientProvider client={new QueryClient()}>
        <PolicyDetailPage
          policy={changeable({
            changes: {
              eligible: true,
              latest: { id: "c9", status: "failed", failureReason: "version_moved" },
            },
          })}
          today={today}
          returnedChange="c9"
        />
      </QueryClientProvider>,
    );
    await expect
      .element(
        page.getByText(
          "Your policy changed while you were paying, so we've refunded you. Please try again.",
        ),
      )
      .toBeVisible();
  });
});

// 6.3c: Change car (Figma 183:3785, 282:3977, 282:4033) and a home's own changes (282:4089,
// 282:4145, 282:4201, 282:4257)

const changeableHome = (over: Partial<PolicyDetail> = {}) =>
  homeDetail({ changes: { eligible: true, latest: null }, ...over });

describe("Make a change, 6.3c", () => {
  it("a car policy shows four cards", async () => {
    await show();
    const car = page.getByRole("region", { name: "Make a change" });
    for (const name of [/Change car/, /Add a driver/, /Change address/, /Change cover/]) {
      await expect.element(car.getByRole("button", { name })).toBeVisible();
    }
  });

  it("a home policy shows three cards, and no renewal or cancel yet", async () => {
    await show(changeableHome());
    const home = page.getByRole("region", { name: "Make a change" });
    for (const name of [/Change cover/, /Update contents/, /Update security/]) {
      await expect.element(home.getByRole("button", { name })).toBeVisible();
    }
    await expect
      .element(home.getByRole("button", { name: /Add a driver/ }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/Review renewal|Cancel policy/)).not.toBeInTheDocument();
  });
});

describe("Change car", () => {
  beforeEach(() => fns.priceMyPolicyChangeFn.mockResolvedValue(priced()));

  it("a demo plate shows We found it and the mileage field; an unknown plate shows We couldn't find that car with Confirm disabled; Choose my car manually shows the four selects", async () => {
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change car/ }));
    const plate = dialog().getByRole("textbox", { name: "New car's registration" });
    await userEvent.fill(plate, "ts24 eiv");
    await expect.element(dialog().getByText("We found it: Tesla Model 3, 2024")).toBeVisible();
    await userEvent.fill(dialog().getByRole("textbox", { name: "Current mileage" }), "9,000");
    await expect.element(dialog().getByText("Your price goes up by £4.60 a month")).toBeVisible();
    expect(fns.priceMyPolicyChangeFn).toHaveBeenLastCalledWith({
      data: {
        input: {
          reference: "KRB-818784",
          change: {
            kind: "car_replaced",
            catalogueVariantId: TESLA_ID,
            registration: "TS24 EIV",
            currentMileage: 9_000,
          },
        },
      },
    });

    await userEvent.fill(plate, "AB12 CDE");
    await expect.element(dialog().getByText("We couldn't find that car")).toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();

    await userEvent.click(dialog().getByRole("button", { name: "Choose my car manually" }));
    for (const name of ["Make", "Model", "Year", "Variant"]) {
      await expect.element(dialog().getByRole("combobox", { name })).toBeVisible();
    }
    await expect
      .element(dialog().getByRole("button", { name: "Look up by registration instead" }))
      .toBeVisible();
  });

  it("Change car: the current car shows That's the car you're already insured for. and no Confirm", async () => {
    await show();
    await userEvent.click(page.getByRole("button", { name: /Change car/ }));
    await userEvent.click(dialog().getByRole("button", { name: "Choose my car manually" }));
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Make" }), "Volkswagen");
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Model" }), "Golf");
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Year" }), "2021");
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Variant" }), GOLF_ID);
    await userEvent.fill(dialog().getByRole("textbox", { name: "Current mileage" }), "20000");
    await expect
      .element(dialog().getByText("That's the car you're already insured for."))
      .toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();
    expect(fns.priceMyPolicyChangeFn).not.toHaveBeenCalled();
  });
});

describe("Home changes", () => {
  beforeEach(() => fns.priceMyPolicyChangeFn.mockResolvedValue(priced()));

  it("Update contents: valuables over contents shows the journey's message and no price", async () => {
    await show(changeableHome());
    await userEvent.click(page.getByRole("button", { name: /Update contents/ }));
    const contents = dialog().getByRole("textbox", { name: "Total contents value" });
    await expect.element(contents).toHaveValue("50,000");
    await userEvent.fill(dialog().getByRole("textbox", { name: "Valuables total" }), "60,000");
    await expect.element(dialog().getByText(/more than the contents total/)).toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();
    expect(fns.priceMyPolicyChangeFn).not.toHaveBeenCalled();
  });

  it("Update security: a null alarm type opens empty and the price waits for it", async () => {
    await show(
      changeableHome({ home: { ...homeDetail().home!, alarmType: null, windowLocks: null } }),
    );
    await userEvent.click(page.getByRole("button", { name: /Update security/ }));
    const alarm = dialog().getByRole("combobox", { name: "Burglar alarm" });
    await expect.element(alarm).toHaveValue("");
    await userEvent.selectOptions(dialog().getByRole("combobox", { name: "Window locks" }), "some");
    expect(fns.priceMyPolicyChangeFn).not.toHaveBeenCalled();
    await userEvent.selectOptions(alarm, "monitored");
    await expect.element(dialog().getByText("Your price goes up by £4.60 a month")).toBeVisible();
    expect(fns.priceMyPolicyChangeFn).toHaveBeenLastCalledWith({
      data: {
        input: {
          reference: expect.any(String),
          change: {
            kind: "home_security",
            lockType: "five_lever",
            windowLocks: "some",
            alarmType: "monitored",
            hasSmokeAlarm: true,
          },
        },
      },
    });
  });

  it("home Change cover: home's level names and add-ons, and no Voluntary excess select", async () => {
    fns.priceMyPolicyChangeFn.mockResolvedValue({
      ok: true,
      data: {
        status: "unchanged",
        levels: [],
        addons: [{ addon: "home_emergency", annualPricePence: 6_000 }],
      },
    });
    await show(changeableHome());
    await userEvent.click(page.getByRole("button", { name: /Change cover/ }));
    await expect.element(dialog().getByText("Home emergency cover")).toBeVisible();
    await expect
      .element(dialog().getByRole("combobox", { name: "Voluntary excess" }))
      .not.toBeInTheDocument();
  });
});
