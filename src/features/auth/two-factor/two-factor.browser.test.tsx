import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { renderWithRouter } from "#/test/router";

import { ChallengeForm } from "./ChallengeForm";
import { ConfirmDialog } from "./ConfirmDialog";
import { SetupSteps } from "./SetupSteps";

// The two-factor screens (4.6, frames 09–13) against a mocked Better Auth client.

const client = vi.hoisted(() => ({
  signOut: vi.fn(),
  signIn: { social: vi.fn() },
  twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn(), enable: vi.fn() },
}));

vi.mock("../auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth-client")>()),
  authClient: client,
}));

const ok = { data: {}, error: null };
const fail = (status: number, code?: string) => ({ data: null, error: { status, code } });

const TOTP_URI = "otpauth://totp/Kerb:maya%40example.com?secret=JBSWY3DPEHPK3PXPK4ZQ&issuer=Kerb";
const BACKUP_CODES = [
  "7KQ2M-X9PLD",
  "H4TZW-2NBQ8",
  "R8VJC-5MEKS",
  "3PDYF-QW7LN",
  "L6XHB-9TRAC",
  "N2GKV-4SZJW",
  "F9MRE-6HDQT",
  "B5WNP-8LCYX",
  "Y3JTA-7KGVF",
  "Q8CSL-2XPMB",
];

const codeInput = () => page.getByLabelText("6-digit code");

beforeEach(() => {
  vi.clearAllMocks();
  client.signOut.mockResolvedValue(ok);
  client.signIn.social.mockResolvedValue(ok);
  client.twoFactor.verifyTotp.mockResolvedValue(ok);
  client.twoFactor.verifyBackupCode.mockResolvedValue(ok);
  client.twoFactor.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: BACKUP_CODES },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChallengeForm (09, 09b, 10)", () => {
  it("09: sends the code without its spaces, then goes on to the redirect", async () => {
    const { router } = await renderWithRouter(<ChallengeForm redirect="/staff" />);
    await expect.element(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await userEvent.fill(codeInput(), "123 456");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    await expect.poll(() => router.state.location.pathname).toBe("/staff");
  });

  it("09b: a wrong code shows the error and puts focus back in the input", async () => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(401, "INVALID_CODE"));
    const { router } = await renderWithRouter(<ChallengeForm redirect="/staff" />, "/here");
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect
      .element(
        page.getByText(
          "That code didn't work. Codes change every 30 seconds, so use the newest one.",
        ),
      )
      .toBeVisible();
    await expect.element(codeInput()).toHaveAttribute("aria-invalid", "true");
    await expect.element(codeInput()).toHaveFocus();
    expect(router.state.location.pathname).toBe("/here");
  });

  it("asks for six digits before sending anything", async () => {
    await renderWithRouter(<ChallengeForm />);
    await userEvent.fill(codeInput(), "123");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect.element(page.getByText("Enter the 6-digit code from your app.")).toBeVisible();
    expect(client.twoFactor.verifyTotp).not.toHaveBeenCalled();
  });

  it.each([
    [400, "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"],
    [401, "INVALID_TWO_FACTOR_COOKIE"],
  ])("09b: a used-up challenge (%i %s) asks you to sign in again", async (status, code) => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(status, code));
    const { router } = await renderWithRouter(<ChallengeForm redirect="/staff" />, "/here");
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect.element(page.getByRole("heading", { name: "Sign in again" })).toBeVisible();
    await expect.element(page.getByText("Too many tries")).toBeVisible();
    await expect.element(page.getByText("Sign in again.", { exact: false })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Back to log in" })).toBeVisible();
    await expect.element(codeInput()).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/here");
  });

  it("a 429 shows the log-in page's 'Too many tries' notice and locks the form", async () => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(429));
    await renderWithRouter(<ChallengeForm />);
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect
      .element(page.getByText("Wait 15 minutes and try again", { exact: false }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Verify" })).toBeDisabled();
  });

  it("stays on the challenge after a server error (a 500 may still have set a cookie)", async () => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(500));
    const { router } = await renderWithRouter(<ChallengeForm redirect="/staff" />, "/here");
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect.element(page.getByText("We couldn't check your code")).toBeVisible();
    await expect.element(codeInput()).toBeVisible();
    expect(router.state.location.pathname).toBe("/here");
  });

  it("never sends disableSession", async () => {
    await renderWithRouter(<ChallengeForm via="email" trust />);
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    expect(client.twoFactor.verifyTotp.mock.calls[0]?.[0]).not.toHaveProperty("disableSession");
  });

  describe("the trust box (call 8)", () => {
    const trustBox = () => page.getByRole("checkbox", { name: "Trust this device for 30 days" });

    it("shows after an email sign-in for a customer, and sends trustDevice when ticked", async () => {
      await renderWithRouter(<ChallengeForm via="email" trust />);
      await expect.element(trustBox()).toBeVisible();
      await userEvent.click(page.getByText("Trust this device for 30 days"));
      await userEvent.fill(codeInput(), "482913");
      await userEvent.click(page.getByRole("button", { name: "Verify" }));
      expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({
        code: "482913",
        trustDevice: true,
      });
    });

    it("is hidden when the server says no (staff)", async () => {
      await renderWithRouter(<ChallengeForm via="email" trust={false} />);
      await expect.element(codeInput()).toBeVisible();
      await expect.element(trustBox()).not.toBeInTheDocument();
    });

    it("is hidden without via=email (the Google challenge)", async () => {
      await renderWithRouter(<ChallengeForm trust />);
      await expect.element(codeInput()).toBeVisible();
      await expect.element(trustBox()).not.toBeInTheDocument();
    });
  });

  it("10: takes a backup code, normalised, and says each works once", async () => {
    await renderWithRouter(<ChallengeForm />);
    await userEvent.click(page.getByRole("button", { name: "Use a backup code instead" }));
    await expect.element(page.getByRole("heading", { name: "Use a backup code" })).toBeVisible();
    await expect.element(page.getByText("Each backup code works once.")).toBeVisible();
    await userEvent.fill(page.getByLabelText("Backup code"), " 7kq2m x9pld ");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    expect(client.twoFactor.verifyBackupCode).toHaveBeenCalledWith({ code: "7KQ2M-X9PLD" });
    await userEvent.click(page.getByRole("button", { name: "Use your authenticator app instead" }));
    await expect.element(codeInput()).toBeVisible();
  });

  it("10: a wrong backup code says so and keeps you there", async () => {
    client.twoFactor.verifyBackupCode.mockResolvedValue(fail(401, "INVALID_BACKUP_CODE"));
    await renderWithRouter(<ChallengeForm mode="backup" />);
    await userEvent.fill(page.getByLabelText("Backup code"), "7KQ2M-X9PLD");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect
      .element(page.getByLabelText("Backup code"))
      .toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByLabelText("Backup code")).toHaveFocus();
  });

  it("Review Focus 4: an off-site redirect goes to /account instead", async () => {
    const { router } = await renderWithRouter(<ChallengeForm redirect="//evil.example" />);
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Verify" }));
    await expect.poll(() => router.state.location.pathname).toBe("/account");
  });

  it("'Not you? Log out' signs out and goes to log in", async () => {
    const { router } = await renderWithRouter(<ChallengeForm />, "/here");
    await userEvent.click(page.getByRole("button", { name: "Log out" }));
    expect(client.signOut).toHaveBeenCalled();
    await expect.poll(() => router.state.location.pathname).toBe("/login");
  });
});

describe("SetupSteps (11a–11c, 12)", () => {
  it("11a: a password is asked for when the account has one, even with Google (Review Focus 1)", async () => {
    await renderWithRouter(
      <SetupSteps setup={{ providers: ["credential", "google"], staff: false }} />,
    );
    await expect
      .element(page.getByText("Step 1 of 3. Enter your password to continue."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
    await userEvent.fill(page.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(page.getByRole("button", { name: "Continue" }));
    expect(client.twoFactor.enable).toHaveBeenCalledWith({ password: "correct horse battery" });
    await expect.element(page.getByText("Step 2 of 3.", { exact: false })).toBeVisible();
  });

  it("11a: a wrong password says so", async () => {
    client.twoFactor.enable.mockResolvedValue(fail(400, "INVALID_PASSWORD"));
    await renderWithRouter(<SetupSteps setup={{ providers: ["credential"], staff: false }} />);
    await userEvent.fill(page.getByLabelText("Password"), "wrong password");
    await userEvent.click(page.getByRole("button", { name: "Continue" }));
    await expect.element(page.getByText("That password isn't right.")).toBeVisible();
    await expect.element(page.getByLabelText("Password")).toHaveFocus();
  });

  it("11a (Google): a Google-only account confirms with Google and comes back to step 2", async () => {
    await renderWithRouter(<SetupSteps setup={{ providers: ["google"], staff: false }} />);
    await expect
      .element(page.getByText("Step 1 of 3. Confirm it's you with Google to continue."))
      .toBeVisible();
    await expect.element(page.getByLabelText("Password")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Continue with Google" }));
    expect(client.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/account/two-factor?step=scan",
    });
  });

  it("back from Google (step=scan), it turns setup on without a password", async () => {
    await renderWithRouter(
      <SetupSteps setup={{ providers: ["google"], staff: false }} step="scan" />,
    );
    await expect.element(page.getByText("Step 2 of 3.", { exact: false })).toBeVisible();
    expect(client.twoFactor.enable).toHaveBeenCalledTimes(1);
    expect(client.twoFactor.enable).toHaveBeenCalledWith({});
  });

  it("back from Google too late (SESSION_NOT_FRESH), it shows the Google step again", async () => {
    client.twoFactor.enable.mockResolvedValue(fail(403, "SESSION_NOT_FRESH"));
    await renderWithRouter(
      <SetupSteps setup={{ providers: ["google"], staff: false }} step="scan" />,
    );
    await expect.element(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  async function toScan() {
    await renderWithRouter(<SetupSteps setup={{ providers: ["credential"], staff: false }} />);
    await userEvent.fill(page.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(page.getByRole("button", { name: "Continue" }));
    await expect.element(page.getByText("Step 2 of 3.", { exact: false })).toBeVisible();
  }

  it("11b: shows the QR code and copies the setup key", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await toScan();
    await expect.element(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await expect.element(page.getByText("JBSW Y3DP EHPK 3PXP K4ZQ")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXPK4ZQ");
  });

  it("11b: on a phone, 'Open in authenticator app' comes before the QR code", async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
      query === "(pointer: coarse)"
        ? Object.create(real(query), { matches: { value: true } })
        : real(query),
    );
    await toScan();
    const open = page.getByRole("link", { name: "Open in authenticator app" });
    await expect.element(open).toHaveAttribute("href", TOTP_URI);
    const qr = page.getByRole("img", { name: /QR code/ }).element();
    expect(
      open.element().compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("11b: on a desktop there's no 'Open in authenticator app' link", async () => {
    await toScan();
    await expect.element(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Open in authenticator app" }))
      .not.toBeInTheDocument();
  });

  it("11b: a wrong code says so; a right one turns it on and shows the backup codes", async () => {
    client.twoFactor.verifyTotp.mockResolvedValueOnce(fail(401, "INVALID_CODE"));
    await toScan();
    const input = page.getByLabelText("Then enter the 6-digit code it shows");
    await userEvent.fill(input, "111 111");
    await userEvent.click(page.getByRole("button", { name: "Turn on two-factor" }));
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "111111" });
    await userEvent.fill(input, "222222");
    await userEvent.click(page.getByRole("button", { name: "Turn on two-factor" }));
    await expect
      .element(page.getByRole("heading", { name: "Save your backup codes" }))
      .toBeVisible();
    await expect.element(page.getByText("Q8CSL-2XPMB")).toBeVisible();
  });

  it("11c: 'Done' waits for the tick, then goes on to the redirect", async () => {
    const { router } = await renderWithRouter(
      <SetupSteps setup={{ providers: ["credential"], staff: true }} redirect="/staff" />,
    );
    await userEvent.click(page.getByRole("button", { name: "Set up two-factor" }));
    await userEvent.fill(page.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(page.getByRole("button", { name: "Continue" }));
    await userEvent.fill(page.getByLabelText("Then enter the 6-digit code it shows"), "222222");
    await userEvent.click(page.getByRole("button", { name: "Turn on two-factor" }));
    const done = page.getByRole("button", { name: "Done" });
    await expect.element(done).toBeDisabled();
    await userEvent.click(page.getByText("I've saved these somewhere safe"));
    await expect.element(done).toBeEnabled();
    await userEvent.click(done);
    await expect.poll(() => router.state.location.pathname).toBe("/staff");
  });

  it("11c: 'Download' saves kerb-backup-codes.txt and 'Copy' copies all ten", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await toScan();
    await userEvent.fill(page.getByLabelText("Then enter the 6-digit code it shows"), "222222");
    await userEvent.click(page.getByRole("button", { name: "Turn on two-factor" }));
    await userEvent.click(page.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("kerb-backup-codes.txt");
    await userEvent.click(page.getByRole("button", { name: "Copy" }));
    expect(writeText.mock.calls[0]?.[0]).toContain(BACKUP_CODES.join("\n"));
  });

  it("12: staff see the gate first; 'Set up two-factor' moves to step 1", async () => {
    await renderWithRouter(<SetupSteps setup={{ providers: ["credential"], staff: true }} />);
    await expect
      .element(page.getByRole("heading", { name: "Staff need two-factor" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Set up two-factor" }));
    await expect
      .element(page.getByText("Step 1 of 3. Enter your password to continue."))
      .toBeVisible();
  });

  it("12: 'Log out' signs out", async () => {
    const { router } = await renderWithRouter(
      <SetupSteps setup={{ providers: ["credential"], staff: true }} />,
      "/here",
    );
    await userEvent.click(page.getByRole("button", { name: "Log out" }));
    expect(client.signOut).toHaveBeenCalled();
    await expect.poll(() => router.state.location.pathname).toBe("/login");
  });
});

describe("ConfirmDialog (13)", () => {
  it("a right code calls onConfirmed", async () => {
    const onConfirmed = vi.fn();
    const onCancel = vi.fn();
    await renderWithRouter(<ConfirmDialog open onConfirmed={onConfirmed} onCancel={onCancel} />);
    await expect.element(page.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible();
    await userEvent.fill(codeInput(), "482 913");
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "482913" });
    await expect.poll(() => onConfirmed.mock.calls.length).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a wrong code says so and doesn't confirm", async () => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(401, "INVALID_CODE"));
    const onConfirmed = vi.fn();
    await renderWithRouter(<ConfirmDialog open onConfirmed={onConfirmed} onCancel={vi.fn()} />);
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    await expect.element(codeInput()).toHaveAttribute("aria-invalid", "true");
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("'Cancel' calls onCancel", async () => {
    const onCancel = vi.fn();
    await renderWithRouter(<ConfirmDialog open onConfirmed={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'Use a backup code' switches to a backup code", async () => {
    const onConfirmed = vi.fn();
    await renderWithRouter(<ConfirmDialog open onConfirmed={onConfirmed} onCancel={vi.fn()} />);
    await userEvent.click(page.getByRole("button", { name: "Use a backup code" }));
    await userEvent.fill(page.getByLabelText("Backup code"), "7kq2mx9pld");
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    expect(client.twoFactor.verifyBackupCode).toHaveBeenCalledWith({ code: "7KQ2M-X9PLD" });
    await expect.poll(() => onConfirmed.mock.calls.length).toBe(1);
  });
  it("after a lockout, closing and opening again starts clean", async () => {
    client.twoFactor.verifyTotp.mockResolvedValue(fail(429));
    await renderWithRouter(<DialogHost />);
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await userEvent.fill(codeInput(), "482913");
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    await expect.element(page.getByText("Too many tries")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await expect.element(page.getByText("Too many tries")).not.toBeInTheDocument();
    await expect.element(codeInput()).toBeEnabled();
    await expect.element(codeInput()).toHaveValue("");
  });

  it("after a backup-code confirm closes it via `open`, it opens again on the TOTP input, empty", async () => {
    await renderWithRouter(<DialogHost />);
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await userEvent.click(page.getByRole("button", { name: "Use a backup code" }));
    await userEvent.fill(page.getByLabelText("Backup code"), "7kq2mx9pld");
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    await expect.element(page.getByText("Confirmed")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(codeInput()).toBeVisible();
    await expect.element(codeInput()).toHaveValue("");
    await expect.element(page.getByLabelText("Backup code")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Use a backup code" })).toBeVisible();
  });
});

/** A parent that opens the dialog and closes it through `open` on confirm or cancel */
function DialogHost() {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {confirmed ? <p>Confirmed</p> : null}
      <ConfirmDialog
        open={open}
        onConfirmed={() => {
          setConfirmed(true);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
