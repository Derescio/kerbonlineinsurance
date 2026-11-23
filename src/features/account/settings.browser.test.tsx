import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { PersonalDetails as Details } from "#/server/data/settings";
import { renderWithRouter } from "#/test/router";

import { PersonalDetails } from "./PersonalDetails";
import { SettingsLayout } from "./SettingsLayout";

// Account settings (6.3; Figma Account · Settings 182:3249), against mocked server functions.

const fns = vi.hoisted(() => ({
  getMyPersonalDetailsFn: vi.fn(),
  getMyRecentActivityFn: vi.fn(),
  updateMyPhoneFn: vi.fn(),
}));
vi.mock("./settings", () => fns);

const maya = (phone: string | null = null): Details => ({
  name: "Maya Patel",
  email: "maya.patel@example.com",
  customer: {
    firstName: "Maya",
    lastName: "Patel",
    dateOfBirth: "1991-06-14",
    phone,
    addressLine1: "Flat 3, 28 Mare Street",
    addressLine2: null,
    town: "London",
    postcode: "E8 3RL",
  },
});

const showPersonal = (details: Details = maya()) =>
  renderWithRouter(
    <SettingsLayout section="personal">
      <PersonalDetails details={details} />
    </SettingsLayout>,
    "/account/settings",
  );

const row = (label: string) => page.getByRole("group", { name: label, exact: true });
/** A details row reads as its label then its value */
const expectRow = (label: string, value: string) =>
  expect.element(row(label)).toHaveTextContent(`${label}${value}`);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Settings layout", () => {
  it("marks the current section and links Payment methods to the Stripe portal", async () => {
    await showPersonal();
    const nav = page.getByRole("navigation", { name: "Settings" });
    await expect
      .element(nav.getByRole("link", { name: "Personal details" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(nav.getByRole("link", { name: "Security" }))
      .toHaveAttribute("href", "/account/settings/security");
    await expect
      .element(nav.getByRole("link", { name: "Payment methods" }))
      .toHaveAttribute("href", "/account/billing");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Account settings" }))
      .toBeVisible();
  });
});

describe("Personal details (frame 01)", () => {
  it("shows the rows, with no way to change the address yet", async () => {
    await showPersonal();
    await expectRow("Full name", "Maya Patel");
    await expectRow("Date of birth", "14 June 1991");
    await expectRow("Email address", "maya.patel@example.com");
    await expectRow("Mobile number", "Not added");
    await expectRow("Home address", "Flat 3, 28 Mare Street, London E8 3RL");
    await expect.element(page.getByRole("button", { name: /change/i })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  });

  it("includes the second address line when there is one", async () => {
    const details = maya();
    details.customer!.addressLine2 = "Hackney";
    await showPersonal(details);
    await expectRow("Home address", "Flat 3, 28 Mare Street, Hackney, London E8 3RL");
  });

  it("shows only the name and email, and no edit, without a customer record", async () => {
    await showPersonal({ name: "Sam Lee", email: "sam@example.com", customer: null });
    await expectRow("Full name", "Sam Lee");
    await expectRow("Email address", "sam@example.com");
    await expect.element(row("Date of birth")).not.toBeInTheDocument();
    await expect.element(row("Mobile number")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Edit details" }))
      .not.toBeInTheDocument();
  });
});

describe("Editing (frame 02)", () => {
  async function openEdit(details = maya()) {
    await showPersonal(details);
    await page.getByRole("button", { name: "Edit details" }).click();
  }

  it("locks the name and email with their hints", async () => {
    await openEdit();
    await expect.element(page.getByLabelText("Full name")).toHaveAttribute("readonly");
    await expect
      .element(
        page.getByText("To change your legal name, call us. We'll need to update your policy too."),
      )
      .toBeVisible();
    await expect.element(page.getByLabelText("Email address")).toHaveAttribute("readonly");
    await expect.element(page.getByText("To change your email, contact us.")).toBeVisible();
    await expect.element(page.getByLabelText("Mobile number")).not.toHaveAttribute("readonly");
  });

  it("shows the new number at once, before the server answers", async () => {
    let answer!: (value: unknown) => void;
    fns.updateMyPhoneFn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await openEdit();
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expectRow("Mobile number", "07700 900418");
    await expect
      .element(page.getByRole("textbox", { name: "Mobile number" }))
      .not.toBeInTheDocument();
    expect(fns.updateMyPhoneFn).toHaveBeenCalledWith({
      data: {
        input: { phone: "07700900418" },
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    answer({ ok: true, data: { set: true } });
    await expectRow("Mobile number", "07700 900418");
  });

  it("rolls back and reopens the form with a message when the server refuses", async () => {
    fns.updateMyPhoneFn.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "x", fields: {} },
    });
    await openEdit();
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect
      .element(page.getByText("We couldn't save your mobile number. Try again."))
      .toBeVisible();
    await expect.element(page.getByLabelText("Mobile number")).toHaveValue("07700900418");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expectRow("Mobile number", "Not added");
  });

  it("rolls back when the call throws", async () => {
    fns.updateMyPhoneFn.mockRejectedValue(new Error("offline"));
    await openEdit(maya("07700 900111"));
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect
      .element(page.getByText("We couldn't save your mobile number. Try again."))
      .toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expectRow("Mobile number", "07700 900111");
  });

  it("shows the server's field error on the field", async () => {
    fns.updateMyPhoneFn.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Check the highlighted fields.",
        fields: { phone: "Enter a UK mobile number, like 07700 900418" },
      },
    });
    await openEdit();
    // Passes the browser's check, so only the server can refuse it
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect
      .element(page.getByText("Enter a UK mobile number, like 07700 900418"))
      .toBeVisible();
  });

  it("checks the number before sending it", async () => {
    await openEdit();
    await userEvent.fill(page.getByLabelText("Mobile number"), "123");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect
      .element(page.getByText("Enter a UK mobile number, like 07700 900418"))
      .toBeVisible();
    expect(fns.updateMyPhoneFn).not.toHaveBeenCalled();
  });

  it("clears the number with an empty field", async () => {
    fns.updateMyPhoneFn.mockResolvedValue({ ok: true, data: { set: false } });
    await openEdit(maya("07700 900111"));
    await userEvent.clear(page.getByLabelText("Mobile number"));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectRow("Mobile number", "Not added");
  });

  it("Cancel closes the form without saving", async () => {
    await openEdit();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByRole("button", { name: "Edit details" })).toBeVisible();
    expect(fns.updateMyPhoneFn).not.toHaveBeenCalled();
  });
});
