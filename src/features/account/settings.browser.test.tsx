import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { PersonalDetails as Details, RecentActivity } from "#/server/data/settings";
import { renderWithRouter } from "#/test/router";

import type { AccountSummary } from "../auth/session";
import { PersonalDetails } from "./PersonalDetails";
import { SecuritySection } from "./SecuritySection";
import { SettingsLayout } from "./SettingsLayout";

// Account settings (6.3; Figma Account · Settings 182:3249), against mocked server functions and a
// mocked Better Auth client.

const fns = vi.hoisted(() => ({
  getMyPersonalDetailsFn: vi.fn(),
  getMyRecentActivityFn: vi.fn(),
  updateMyPhoneFn: vi.fn(),
}));
vi.mock("./settings", () => fns);

const client = vi.hoisted(() => ({
  twoFactor: { disable: vi.fn() },
  signIn: { social: vi.fn() },
  linkSocial: vi.fn(),
}));
vi.mock("../auth/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/auth-client")>()),
  authClient: client,
}));

const session = vi.hoisted(() => ({ signOutEverywhereFn: vi.fn() }));
vi.mock("../auth/session", () => session);

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

describe("Security (frame 06)", () => {
  const now = new Date("2026-11-22T15:00:00Z");
  const summary = (over: Partial<AccountSummary> = {}): AccountSummary => ({
    user: { id: "u1", name: "Maya Patel", email: "maya@example.com", emailVerified: true },
    providers: ["credential"],
    twoFactorEnabled: true,
    ...over,
  });
  const activity: RecentActivity[] = [
    {
      type: "sign_in",
      method: "password",
      device: "Chrome on Windows",
      at: "2026-11-22T13:00:00Z",
    },
    {
      type: "sign_in_failed",
      method: null,
      device: "Safari on iPhone",
      at: "2026-11-21T21:14:00Z",
    },
    { type: "sign_out", method: null, device: null, at: "2026-11-12T09:00:00Z" },
  ];
  const twoFactorRow = () => page.getByRole("group", { name: "Two-factor", exact: true });
  const turnOffDialog = () => page.getByRole("dialog", { name: "Turn off two-factor?" });

  const showSecurity = (over: Partial<AccountSummary> = {}, staff = false, rows = activity) =>
    renderWithRouter(
      <SettingsLayout section="security">
        <SecuritySection summary={summary(over)} staff={staff} activity={rows} now={now} />
      </SettingsLayout>,
      "/account/settings/security",
    );

  it("offers to turn two-factor on when it's off", async () => {
    await showSecurity({ twoFactorEnabled: false });
    await expect.element(twoFactorRow().getByText("Off", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Add a code from an authenticator app when you log in."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Turn on" }))
      .toHaveAttribute("href", "/account/two-factor?redirect=%2Faccount%2Fsettings%2Fsecurity");
  });

  it("offers to turn it off when it's on", async () => {
    await showSecurity();
    await expect.element(twoFactorRow().getByText("On", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("You'll enter a code from your authenticator app when you log in."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Turn off" })).toBeVisible();
  });

  it("tells staff they keep it on", async () => {
    await showSecurity({}, true);
    await expect.element(page.getByText("Staff accounts keep two-factor on.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  });

  it("turns it off with the password, showing Off at once", async () => {
    let answer!: (value: unknown) => void;
    client.twoFactor.disable.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await showSecurity();
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect
      .element(
        turnOffDialog().getByText(
          "Anyone with your password will be able to log in without a code.",
        ),
      )
      .toBeVisible();
    await userEvent.fill(turnOffDialog().getByLabelText("Password"), "my long password");
    await turnOffDialog().getByRole("button", { name: "Turn off two-factor" }).click();

    await expect.element(twoFactorRow().getByText("Off", { exact: true })).toBeVisible();
    await expect.element(turnOffDialog()).not.toBeInTheDocument();
    expect(client.twoFactor.disable).toHaveBeenCalledWith({ password: "my long password" });
    answer({ data: { status: true }, error: null });
    await expect.element(twoFactorRow().getByText("Off", { exact: true })).toBeVisible();
  });

  it("goes back to On and says so when the password is wrong", async () => {
    client.twoFactor.disable.mockResolvedValue({
      data: null,
      error: { status: 400, code: "INVALID_PASSWORD" },
    });
    await showSecurity();
    await page.getByRole("button", { name: "Turn off" }).click();
    await userEvent.fill(turnOffDialog().getByLabelText("Password"), "wrong");
    await turnOffDialog().getByRole("button", { name: "Turn off two-factor" }).click();

    await expect.element(turnOffDialog().getByText("That password isn't right.")).toBeVisible();
    await expect.element(twoFactorRow().getByText("On", { exact: true })).toBeVisible();
  });

  it("goes back to On with a toast when the server refuses for another reason", async () => {
    client.twoFactor.disable.mockResolvedValue({ data: null, error: { status: 500 } });
    await showSecurity();
    await page.getByRole("button", { name: "Turn off" }).click();
    await userEvent.fill(turnOffDialog().getByLabelText("Password"), "my long password");
    await turnOffDialog().getByRole("button", { name: "Turn off two-factor" }).click();

    await expect.element(page.getByText("Two-factor is still on")).toBeVisible();
    await expect.element(twoFactorRow().getByText("On", { exact: true })).toBeVisible();
  });

  it("asks a Google-only account to confirm with Google when its sign-in is old", async () => {
    client.twoFactor.disable.mockResolvedValue({
      data: null,
      error: { status: 403, code: "SESSION_NOT_FRESH" },
    });
    client.signIn.social.mockReturnValue(new Promise(() => {}));
    await showSecurity({ providers: ["google"] });
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect.element(turnOffDialog().getByLabelText("Password")).not.toBeInTheDocument();
    await turnOffDialog().getByRole("button", { name: "Turn off two-factor" }).click();

    expect(client.twoFactor.disable).toHaveBeenCalledWith({});
    await expect
      .element(turnOffDialog().getByText("For your security, confirm with Google first."))
      .toBeVisible();
    await expect.element(twoFactorRow().getByText("On", { exact: true })).toBeVisible();
    await turnOffDialog()
      .getByRole("button", { name: /Google/ })
      .click();
    expect(client.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/account/settings/security",
    });
  });

  it("signs out everywhere after confirming, then goes to log in", async () => {
    session.signOutEverywhereFn.mockResolvedValue({ revoked: 2 });
    const { router } = await showSecurity();
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign out everywhere?" });
    await expect
      .element(
        dialog.getByText(
          "You'll be signed out on every device, including this one. You'll need to log in again.",
        ),
      )
      .toBeVisible();
    await dialog.getByRole("button", { name: "Sign out everywhere" }).click();
    expect(session.signOutEverywhereFn).toHaveBeenCalled();
    await expect.poll(() => router.state.location.href).toBe("/login?signedOut=everywhere");
  });

  it("lists recent activity, failures in the warning style", async () => {
    await showSecurity();
    const items = page.getByRole("region", { name: "Recent activity" }).getByRole("listitem");
    await expect
      .element(items.nth(0))
      .toHaveTextContent("Signed inChrome on Windows · 2 hours ago");
    await expect
      .element(items.nth(1))
      .toHaveTextContent("Failed sign-in attemptSafari on iPhone · Yesterday, 21:14");
    await expect.element(items.nth(1)).toHaveClass(/settings__activity--warning/);
    await expect.element(items.nth(2)).toHaveTextContent("Signed outUnknown device · 12 Nov 2026");
  });

  it("says when there's no activity", async () => {
    await showSecurity({}, false, []);
    await expect.element(page.getByText("No activity yet.")).toBeVisible();
  });

  it("comes back to Security after connecting Google", async () => {
    client.linkSocial.mockReturnValue(new Promise(() => {}));
    await showSecurity();
    await page.getByRole("button", { name: "Connect Google" }).click();
    expect(client.linkSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/account/settings/security?linked=google",
      errorCallbackURL: "/account/settings/security?error=link",
    });
  });

  it("keeps ways to log in and closing the account", async () => {
    await showSecurity();
    await expect
      .element(page.getByText("Email and password. Connect Google to log in with one tap."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Close your account" }))
      .toHaveAttribute("href", "/account/close");
  });
});

// Checkpoint review after Task 5: races, focus and the less common refusals
describe("Settings edge cases", () => {
  const securitySummary: AccountSummary = {
    user: { id: "u1", name: "Maya Patel", email: "maya@example.com", emailVerified: true },
    providers: ["credential"],
    twoFactorEnabled: true,
  };
  const showSecurity = (summary: AccountSummary = securitySummary) =>
    renderWithRouter(
      <SettingsLayout section="security">
        <SecuritySection summary={summary} staff={false} activity={[]} />
      </SettingsLayout>,
      "/account/settings/security",
    );
  const turnOffDialog = () => page.getByRole("dialog", { name: "Turn off two-factor?" });
  async function submitTurnOff(password = "my long password") {
    await page.getByRole("button", { name: "Turn off" }).click();
    await userEvent.fill(turnOffDialog().getByLabelText("Password"), password);
    await turnOffDialog().getByRole("button", { name: "Turn off two-factor" }).click();
  }

  it("keeps Edit details disabled while a save is in flight", async () => {
    let answer!: (value: unknown) => void;
    fns.updateMyPhoneFn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await showPersonal();
    await page.getByRole("button", { name: "Edit details" }).click();
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.element(page.getByRole("button", { name: "Edit details" })).toBeDisabled();
    answer({ ok: true, data: { set: true } });
    await expect.element(page.getByRole("button", { name: "Edit details" })).toBeEnabled();
  });

  it("puts focus on the mobile field when a save is refused", async () => {
    fns.updateMyPhoneFn.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "x", fields: {} },
    });
    await showPersonal();
    await page.getByRole("button", { name: "Edit details" }).click();
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.element(page.getByRole("textbox", { name: "Mobile number" })).toHaveFocus();
  });

  it("puts focus back on Edit details after a save", async () => {
    fns.updateMyPhoneFn.mockResolvedValue({ ok: true, data: { set: true } });
    await showPersonal();
    await page.getByRole("button", { name: "Edit details" }).click();
    await userEvent.fill(page.getByLabelText("Mobile number"), "07700900418");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.element(page.getByRole("button", { name: "Edit details" })).toHaveFocus();
  });

  it("says to wait when turning two-factor off is rate limited", async () => {
    client.twoFactor.disable.mockResolvedValue({ data: null, error: { status: 429 } });
    await showSecurity();
    await submitTurnOff();
    await expect.element(page.getByText("Too many tries")).toBeVisible();
    await expect.element(page.getByText("Two-factor is still on")).not.toBeInTheDocument();
  });

  it("never sends a password account to Google for a stale session", async () => {
    client.twoFactor.disable.mockResolvedValue({
      data: null,
      error: { status: 403, code: "SESSION_NOT_FRESH" },
    });
    await showSecurity();
    await submitTurnOff();
    await expect.element(page.getByText("Two-factor is still on")).toBeVisible();
    await expect
      .element(page.getByText("For your security, confirm with Google first."))
      .not.toBeInTheDocument();
  });

  it("puts focus on the password after a wrong one", async () => {
    client.twoFactor.disable.mockResolvedValue({
      data: null,
      error: { status: 400, code: "INVALID_PASSWORD" },
    });
    await showSecurity();
    await submitTurnOff("wrong");
    await expect.element(turnOffDialog().getByLabelText("Password")).toHaveFocus();
  });

  it("describes the sign out everywhere dialog", async () => {
    await showSecurity();
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Sign out everywhere?" }))
      .toHaveAccessibleDescription(
        "You'll be signed out on every device, including this one. You'll need to log in again.",
      );
  });

  it("names Recent activity once", async () => {
    await renderWithRouter(
      <SecuritySection summary={securitySummary} staff={false} activity={[]} />,
    );
    await expect.element(page.getByRole("region", { name: "Recent activity" })).toBeVisible();
  });

  it("says still signed in only when the sign-out itself fails", async () => {
    session.signOutEverywhereFn.mockRejectedValue(new Error("down"));
    await showSecurity();
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await page
      .getByRole("dialog", { name: "Sign out everywhere?" })
      .getByRole("button", { name: "Sign out everywhere" })
      .click();
    await expect.element(page.getByText("Still signed in")).toBeVisible();
  });
});
