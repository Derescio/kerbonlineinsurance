import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { AccountSummary } from "#/features/auth/session";
import { renderWithRouter } from "#/test/router";

import { LOG_OUT_FAILED } from "../auth/log-out";
import { AccountSettings } from "./AccountSettings";
import { AccountShell } from "./AccountShell";

// The account header (6.1, decision 1; Figma 258:3608 and 258:3683) and the settings that moved
// off the Overview to /account/settings (decision 2).

vi.mock("./closure", () => ({
  getClosureBanner: vi.fn().mockResolvedValue(null),
  keepMyAccount: vi.fn(),
}));
const client = vi.hoisted(() => ({ signOut: vi.fn(), linkSocial: vi.fn() }));
vi.mock("../auth/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/auth-client")>()),
  authClient: client,
}));
const leave = vi.hoisted(() => ({ leaveTo: vi.fn() }));
vi.mock("#/lib/leave", () => leave);

beforeEach(() => {
  vi.clearAllMocks();
  client.signOut.mockResolvedValue({});
  client.linkSocial.mockResolvedValue({ data: {}, error: null });
});

describe("avatar initials", () => {
  async function avatar(name: string) {
    await renderWithRouter(
      <AccountShell name={name}>
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    return page.getByRole("button", { name: /account menu$/ });
  }

  it("uses the first and last words' first letters", async () => {
    await expect.element(await avatar("maya van der berg")).toHaveTextContent("MB");
  });
  it("has one letter for one word", async () => {
    await expect.element(await avatar("Cher")).toHaveTextContent("C");
  });
  it("shows ? when there is no name", async () => {
    await expect.element(await avatar("   ")).toHaveTextContent("?");
  });
});

describe("AccountShell", () => {
  it("shows Overview as the current tab, and no tab or bell that leads nowhere yet", async () => {
    await renderWithRouter(
      <AccountShell name="Maya Patel" current="overview">
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    const nav = page.getByRole("navigation", { name: "Account" });
    await expect
      .element(nav.getByRole("link", { name: "Overview" }))
      .toHaveAttribute("aria-current", "page");
    for (const name of ["Policies", "Claims", "Documents", "Notifications"]) {
      await expect.element(page.getByRole("link", { name })).not.toBeInTheDocument();
    }
    await expect.element(page.getByRole("main")).toHaveTextContent("Body");
  });

  it("opens the avatar menu with Account settings and Log out, and closes on Escape", async () => {
    await renderWithRouter(
      <AccountShell name="Maya Patel" current="overview">
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    // Its name starts with what it shows, for voice control (WCAG 2.5.3)
    const avatar = page.getByRole("button", { name: "MP, account menu", exact: true });
    await expect.element(avatar).toHaveTextContent("MP");
    await userEvent.click(avatar);
    await expect
      .element(page.getByRole("link", { name: "Account settings" }))
      .toHaveAttribute("href", "/account/settings");
    await userEvent.keyboard("{Escape}");
    await expect.element(avatar).toHaveAttribute("aria-expanded", "false");
    await expect.element(avatar).toHaveFocus();
  });

  it("logs out from the avatar menu, then goes home", async () => {
    await renderWithRouter(
      <AccountShell name="Maya Patel" current="overview">
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    const avatar = page.getByRole("button", { name: "MP, account menu" });
    await userEvent.click(avatar);
    await userEvent.click(page.getByRole("button", { name: "Log out" }));
    await expect.poll(() => leave.leaveTo.mock.calls).toEqual([["/"]]);
    expect(client.signOut).toHaveBeenCalled();
    await expect.element(avatar).toHaveFocus();
  });

  it("stays signed in and says so when log out fails", async () => {
    client.signOut.mockResolvedValue({ error: { status: 500 } });
    await renderWithRouter(
      <AccountShell name="Maya Patel" current="overview">
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    const avatar = page.getByRole("button", { name: "MP, account menu" });
    await userEvent.click(avatar);
    await userEvent.click(page.getByRole("button", { name: "Log out" }));
    await expect.element(page.getByText(LOG_OUT_FAILED)).toBeVisible();
    expect(leave.leaveTo).not.toHaveBeenCalled();
    await expect.element(avatar).toHaveFocus();
  });

  it("closes the avatar menu when Tab leaves it", async () => {
    await renderWithRouter(
      <AccountShell name="Maya Patel" current="overview">
        <p>Body</p>
      </AccountShell>,
      "/account",
    );
    const avatar = page.getByRole("button", { name: "MP, account menu" });
    await userEvent.click(avatar);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(avatar).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AccountSettings (moved from /account)", () => {
  const summary: AccountSummary = {
    user: { id: "u1", name: "Maya Patel", email: "maya@example.com", emailVerified: true },
    providers: ["credential"],
    twoFactorEnabled: false,
  };

  it("has ways to log in, two-factor and closing the account", async () => {
    await renderWithRouter(<AccountSettings summary={summary} />, "/account/settings");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Account settings" }))
      .toBeVisible();
    for (const name of ["Ways to log in", "Two-factor", "Close your account"]) {
      await expect.element(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
  });

  it("comes back to settings after connecting Google", async () => {
    await renderWithRouter(<AccountSettings summary={summary} />, "/account/settings");
    await userEvent.click(page.getByRole("button", { name: "Connect Google" }));
    expect(client.linkSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/account/settings?linked=google",
      errorCallbackURL: "/account/settings?error=link",
    });
  });
});
