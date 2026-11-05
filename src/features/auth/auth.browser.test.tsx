import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { renderWithRouter } from "#/test/router";

import { ForgotPasswordForm } from "./PasswordResetForms";
import { LoginForm } from "./LoginForm";
import { SignUpForm } from "./SignUpForm";

// The auth forms (4.4) against a mocked Better Auth client: validation, focus, the 4.3 error
// states, the Google button and Turnstile.

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
}));

vi.mock("./auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-client")>()),
  authClient: client,
}));

// Cloudflare's widget doesn't load in tests: a button stands in for "the check passed"
vi.mock("./Turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (token: string | null) => void }) => (
    <button type="button" onClick={() => onToken("test-token")}>
      Pass robot check
    </button>
  ),
}));

const ok = { data: {}, error: null };
const fail = (status: number, code?: string) => ({ data: null, error: { status, code } });

beforeEach(() => {
  vi.clearAllMocks();
  client.signIn.email.mockResolvedValue(ok);
  client.signIn.social.mockResolvedValue(ok);
  client.signUp.email.mockResolvedValue(ok);
  client.requestPasswordReset.mockResolvedValue(ok);
});

describe("LoginForm", () => {
  it("posts, so a submit before the JavaScript loads never puts the password in the URL", async () => {
    const { screen } = await renderWithRouter(<LoginForm redirectTo="/account" />);
    expect(screen.container.querySelector("form")?.getAttribute("method")).toBe("post");
  });

  it("asks for an email first and focuses it", async () => {
    await renderWithRouter(<LoginForm redirectTo="/account" />);
    await userEvent.click(page.getByRole("button", { name: "Log in" }));
    const email = page.getByLabelText("Email address");
    await expect.element(page.getByText("Enter your email address.")).toBeVisible();
    await expect.element(email).toHaveAttribute("aria-invalid", "true");
    await expect.element(email).toHaveFocus();
    expect(client.signIn.email).not.toHaveBeenCalled();
  });

  it("signs in and goes to the redirect", async () => {
    const { router } = await renderWithRouter(<LoginForm redirectTo="/account" />);
    await userEvent.fill(page.getByLabelText("Email address"), "Maya.Patel@example.com");
    await userEvent.fill(page.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(page.getByRole("button", { name: "Log in" }));
    expect(client.signIn.email).toHaveBeenCalledWith({
      email: "maya.patel@example.com",
      password: "correct horse battery",
      rememberMe: true,
    });
    await expect.poll(() => router.state.location.pathname).toBe("/account");
  });

  it("never says which half was wrong (02)", async () => {
    client.signIn.email.mockResolvedValue(fail(401, "INVALID_EMAIL_OR_PASSWORD"));
    await renderWithRouter(<LoginForm redirectTo="/account" />);
    await userEvent.fill(page.getByLabelText("Email address"), "maya.patel@example.com");
    await userEvent.fill(page.getByLabelText("Password"), "wrong password");
    await userEvent.click(page.getByRole("button", { name: "Log in" }));
    await expect.element(page.getByText("That email and password don't match.")).toBeVisible();
    await expect.element(page.getByLabelText("Password")).toHaveFocus();
  });

  it("shows 'Too many tries' and locks the form on a 429 (02b)", async () => {
    client.signIn.email.mockResolvedValue(fail(429));
    await renderWithRouter(<LoginForm redirectTo="/account" />);
    await userEvent.fill(page.getByLabelText("Email address"), "maya.patel@example.com");
    await userEvent.fill(page.getByLabelText("Password"), "wrong password");
    await userEvent.click(page.getByRole("button", { name: "Log in" }));
    await expect.element(page.getByText("Too many tries")).toBeVisible();
    await expect.element(page.getByLabelText("Email address")).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("starts Google sign-in", async () => {
    await renderWithRouter(<LoginForm redirectTo="/account" />);
    await userEvent.click(page.getByRole("button", { name: "Continue with Google" }));
    expect(client.signIn.social).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", errorCallbackURL: "/login" }),
    );
  });

  it("explains a refused Google sign-in on a verified account (08b)", async () => {
    await renderWithRouter(<LoginForm redirectTo="/account" error="ACCOUNT_EXISTS_VERIFIED" />);
    await expect.element(page.getByText("You already have a Kerb account")).toBeVisible();
  });

  it("shows a failed Google sign-in (08)", async () => {
    await renderWithRouter(<LoginForm redirectTo="/account" error="access_denied" />);
    await expect.element(page.getByText("Google sign-in didn't work")).toBeVisible();
  });
});

describe("SignUpForm", () => {
  async function fillValid() {
    await userEvent.fill(page.getByLabelText("Full name"), "Maya Patel");
    await userEvent.fill(page.getByLabelText("Email address"), "maya.patel@example.com");
    await userEvent.fill(page.getByLabelText("Create a password"), "correct horse battery");
  }

  it("ticks the password hint at 10 characters", async () => {
    await renderWithRouter(<SignUpForm />);
    const field = page.getByLabelText("Create a password");
    await userEvent.fill(field, "123456789");
    await expect.element(page.getByText("(done)")).not.toBeInTheDocument();
    await userEvent.fill(field, "1234567890");
    await expect.element(page.getByText("(done)", { exact: false })).toBeInTheDocument();
    await expect
      .element(field)
      .toHaveAttribute("aria-describedby", expect.stringContaining("signup-password-hint"));
  });

  it("needs the terms box and the robot check before it sends anything", async () => {
    await renderWithRouter(<SignUpForm />);
    await fillValid();
    await userEvent.click(page.getByRole("button", { name: "Create account" }));
    await expect.element(page.getByText("Tick to agree to the terms of use.")).toBeVisible();
    await expect
      .element(page.getByText("Wait for the check above to finish, then try again."))
      .toBeVisible();
    expect(client.signUp.email).not.toHaveBeenCalled();
  });

  it("sends the Turnstile token in a header, then goes to the account", async () => {
    const { router } = await renderWithRouter(<SignUpForm />);
    await fillValid();
    await userEvent.click(page.getByText("I agree to the terms of use"));
    await userEvent.click(page.getByRole("button", { name: "Pass robot check" }));
    await userEvent.click(page.getByRole("button", { name: "Create account" }));
    expect(client.signUp.email).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Maya Patel",
        email: "maya.patel@example.com",
        acceptTerms: true,
        callbackURL: "/email-confirmed",
      }),
      { headers: { "x-captcha-response": "test-token" } },
    );
    await expect.poll(() => router.state.location.pathname).toBe("/account");
  });

  it("shows the breached-password message on the field (03b)", async () => {
    client.signUp.email.mockResolvedValue(fail(400, "PASSWORD_COMPROMISED"));
    await renderWithRouter(<SignUpForm />);
    await fillValid();
    await userEvent.click(page.getByText("I agree to the terms of use"));
    await userEvent.click(page.getByRole("button", { name: "Pass robot check" }));
    await userEvent.click(page.getByRole("button", { name: "Create account" }));
    await expect
      .element(page.getByText("This password was in a data breach. Try a different one."))
      .toBeVisible();
    await expect.element(page.getByLabelText("Create a password")).toHaveFocus();
  });
});

describe("ForgotPasswordForm", () => {
  it("says the same thing whether or not the email has an account (05)", async () => {
    await renderWithRouter(<ForgotPasswordForm />);
    await userEvent.fill(page.getByLabelText("Email address"), "anyone@example.com");
    await userEvent.click(page.getByRole("button", { name: "Pass robot check" }));
    await userEvent.click(page.getByRole("button", { name: "Send reset link" }));
    expect(client.requestPasswordReset).toHaveBeenCalledWith(
      { email: "anyone@example.com", redirectTo: "/reset-password" },
      { headers: { "x-captcha-response": "test-token" } },
    );
    await expect.element(page.getByText("Reset link sent")).toBeVisible();
    await expect
      .element(page.getByText("If there's an account for that email", { exact: false }))
      .toBeVisible();
  });
});
