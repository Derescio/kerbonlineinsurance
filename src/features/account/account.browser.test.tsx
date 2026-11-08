import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { PublicError } from "#/server/auth/errors";
import { renderWithRouter } from "#/test/router";

import { ClosePage } from "./ClosePage";
import { ClosureBanner } from "./ClosureBanner";
import type { ClosePageData } from "./closure";

// /account/close in its four versions and the closure banner (4.7), against mocked server
// functions and a mocked Better Auth client.

const fns = vi.hoisted(() => ({
  getClosureBanner: vi.fn(),
  deleteMyAccount: vi.fn(),
  requestMyClosure: vi.fn(),
  keepMyAccount: vi.fn(),
}));
vi.mock("./closure", () => fns);

const client = vi.hoisted(() => ({ signOut: vi.fn(), signIn: { social: vi.fn() } }));
vi.mock("../auth/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/auth-client")>()),
  authClient: client,
}));

const ok = (data: unknown) => ({ ok: true, data });
const deleteData: ClosePageData = { kind: "delete", providers: ["credential"], twoFactor: false };
const closeData: Extract<ClosePageData, { kind: "close" }> = {
  kind: "close",
  providers: ["credential"],
  twoFactor: false,
  openClaim: null,
  closesOn: "2026-12-07T10:00:00.000Z",
  records: {
    policies: [
      { id: "p1", product: "home", status: "active" },
      { id: "p2", product: "pet", status: "cancelled" },
    ],
    claims: [
      { reference: "CLM-1001", open: true },
      { reference: "CLM-0999", open: false },
    ],
    hasPayments: true,
    hasBundles: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  client.signIn.social.mockResolvedValue({ data: {}, error: null });
  fns.getClosureBanner.mockResolvedValue(null);
  fns.deleteMyAccount.mockResolvedValue(ok({ deleted: true }));
  fns.requestMyClosure.mockResolvedValue(ok({ closesAt: "2026-12-07T10:00:00.000Z" }));
  fns.keepMyAccount.mockResolvedValue(ok({ kept: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/account/close, delete version", () => {
  it("shows the copy and a password field, and no code field", async () => {
    await renderWithRouter(<ClosePage data={deleteData} />);
    await expect.element(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "This deletes your Kerb account and everything in it straight away. It can't be undone.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByLabelText("Password")).toBeVisible();
    expect(page.getByLabelText("6-digit code").elements()).toHaveLength(0);
    await expect.element(page.getByRole("link", { name: "Keep my account" })).toBeVisible();
  });

  it("shows the code field only when two-factor is on", async () => {
    await renderWithRouter(<ClosePage data={{ ...deleteData, twoFactor: true }} />);
    await expect.element(page.getByLabelText("6-digit code")).toBeVisible();
  });

  it("deletes, then goes to /account-deleted", async () => {
    const { router } = await renderWithRouter(<ClosePage data={deleteData} />);
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.poll(() => router.state.location.pathname).toBe("/account-deleted");
    expect(fns.deleteMyAccount).toHaveBeenCalledWith({
      data: { input: { password: "correct horse" } },
    });
  });

  it("says it's deleting while the request is in flight", async () => {
    fns.deleteMyAccount.mockReturnValue(new Promise(() => {}));
    await renderWithRouter(<ClosePage data={deleteData} />);
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect
      .element(page.getByRole("button", { name: "Deleting your account…" }))
      .toBeVisible();
  });

  it("shows the server's field error and stays put", async () => {
    fns.deleteMyAccount.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "That password isn't right.",
        fields: { password: "That password isn't right." },
      },
    });
    const { router } = await renderWithRouter(<ClosePage data={deleteData} />, "/account/close");
    await userEvent.fill(page.getByLabelText("Password"), "wrong");
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.element(page.getByText("That password isn't right.")).toBeVisible();
    expect(router.state.location.pathname).toBe("/account/close");
  });

  it("asks for the password before calling the server", async () => {
    await renderWithRouter(<ClosePage data={deleteData} />);
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.element(page.getByText("Enter your password.")).toBeVisible();
    expect(fns.deleteMyAccount).not.toHaveBeenCalled();
  });

  it("replaces the password with Continue with Google for a Google-only user", async () => {
    await renderWithRouter(
      <ClosePage data={{ kind: "delete", providers: ["google"], twoFactor: false }} />,
    );
    expect(page.getByLabelText("Password").elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Continue with Google" }));
    expect(client.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/account/close",
    });
  });
});

describe("/account/close, close version", () => {
  it("lists the policies and claims and says cover carries on", async () => {
    await renderWithRouter(<ClosePage data={closeData} />);
    await expect
      .element(page.getByRole("heading", { name: "Close your Kerb account?" }))
      .toBeVisible();
    await expect.element(page.getByText("home · active")).toBeVisible();
    await expect.element(page.getByText("pet · cancelled")).toBeVisible();
    await expect.element(page.getByText("Claim CLM-1001 · open")).toBeVisible();
    await expect.element(page.getByText("Claim CLM-0999 · closed")).toBeVisible();
    await expect
      .element(page.getByText("Closing your account doesn't cancel your cover."))
      .toBeVisible();
    await expect
      .element(page.getByText(/keep your account any time before 7 December/))
      .toBeVisible();
    expect(page.getByText(/will close once claim/).elements()).toHaveLength(0);
  });

  it("shows the open-claim line when a claim is open", async () => {
    await renderWithRouter(<ClosePage data={{ ...closeData, openClaim: "CLM-1001" }} />);
    await expect
      .element(page.getByText("Your account will close once claim CLM-1001 is settled."))
      .toBeVisible();
  });

  it("requests closure with the proof and an idempotency key", async () => {
    await renderWithRouter(<ClosePage data={closeData} />);
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Request account closure" }));
    await expect.poll(() => fns.requestMyClosure.mock.calls.length).toBe(1);
    const { data } = fns.requestMyClosure.mock.calls[0]![0];
    expect(data.input).toEqual({ password: "correct horse" });
    expect(data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("says it's requesting closure while the request is in flight (found in 4.9)", async () => {
    fns.requestMyClosure.mockReturnValue(new Promise(() => {}));
    await renderWithRouter(<ClosePage data={closeData} />);
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Request account closure" }));
    const busy = page.getByRole("button", { name: "Requesting closure…" });
    await expect.element(busy).toBeVisible();
    await expect.element(busy).toHaveAttribute("aria-busy", "true");
  });
});

describe("/account/close, closing and staff", () => {
  it("shows the staff sentence and no form", async () => {
    await renderWithRouter(<ClosePage data={{ kind: "staff" }} />);
    await expect
      .element(
        page.getByText("Staff accounts are closed by an admin. Ask an admin to deactivate yours."),
      )
      .toBeVisible();
    expect(document.querySelector("form")).toBeNull();
  });

  it("offers Keep my account while closing, and confirms it", async () => {
    await renderWithRouter(
      <ClosePage data={{ kind: "closing", closesAt: "2026-12-07T10:00:00.000Z", held: false }} />,
    );
    await expect.element(page.getByText("Your account closes on 7 December.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Keep my account" }));
    await expect.element(page.getByText("Your account will stay open")).toBeVisible();
    expect(fns.keepMyAccount).toHaveBeenCalledTimes(1);
  });

  it("says it's keeping the account while that request is in flight", async () => {
    fns.keepMyAccount.mockReturnValue(new Promise(() => {}));
    await renderWithRouter(
      <ClosePage data={{ kind: "closing", closesAt: "2026-12-07T10:00:00.000Z", held: false }} />,
    );
    await userEvent.click(page.getByRole("button", { name: "Keep my account" }));
    await expect.element(page.getByRole("button", { name: "Keeping your account…" })).toBeVisible();
  });
});

describe("ClosureBanner", () => {
  it("says when the account closes, in UK time", async () => {
    fns.getClosureBanner.mockResolvedValue({
      closesAt: "2026-12-07T10:00:00.000Z",
      held: false,
    });
    await renderWithRouter(<ClosureBanner />);
    await expect.element(page.getByText("Your account closes on 7 December.")).toBeVisible();
  });

  it("uses the UK date at a midnight boundary", async () => {
    // 23:30 UTC on 6 July is 00:30 on 7 July in London (BST)
    fns.getClosureBanner.mockResolvedValue({
      closesAt: "2027-07-06T23:30:00.000Z",
      held: false,
    });
    await renderWithRouter(<ClosureBanner />);
    await expect.element(page.getByText("Your account closes on 7 July.")).toBeVisible();
  });

  it("says the account closes once the claim is settled when held", async () => {
    fns.getClosureBanner.mockResolvedValue({
      closesAt: "2026-12-07T10:00:00.000Z",
      held: true,
    });
    await renderWithRouter(<ClosureBanner />);
    await expect
      .element(page.getByText("Your account will close once your claim is settled."))
      .toBeVisible();
  });

  it("keeps the account on one click and then confirms", async () => {
    fns.getClosureBanner.mockResolvedValue({
      closesAt: "2026-12-07T10:00:00.000Z",
      held: false,
    });
    await renderWithRouter(<ClosureBanner />);
    await userEvent.click(page.getByRole("button", { name: "Keep my account" }));
    await expect.element(page.getByText("Your account will stay open.")).toBeVisible();
    expect(fns.keepMyAccount).toHaveBeenCalledTimes(1);
    expect(fns.keepMyAccount.mock.calls[0]![0].data.input).toEqual({});
  });

  it("renders nothing when there is no closure", async () => {
    const { screen } = await renderWithRouter(<ClosureBanner />);
    await expect.poll(() => fns.getClosureBanner.mock.calls.length).toBe(1);
    expect(screen.container.textContent).toBe("");
  });
});

describe("delete: an UNAUTHENTICATED answer", () => {
  const unauthenticated = () =>
    PublicError.from({ code: "UNAUTHENTICATED", status: 401, message: "Please log in." });

  it("on the first try means the session ended: go to log in, not /account-deleted", async () => {
    fns.deleteMyAccount.mockRejectedValue(unauthenticated());
    const { router } = await renderWithRouter(<ClosePage data={deleteData} />, "/account/close");
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.poll(() => router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/account/close" });
  });

  it("after a lost response means the first try worked: go to /account-deleted", async () => {
    fns.deleteMyAccount
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(unauthenticated());
    const { router } = await renderWithRouter(<ClosePage data={deleteData} />, "/account/close");
    await userEvent.fill(page.getByLabelText("Password"), "correct horse");
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.element(page.getByText("Something went wrong. Please try again.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
    await expect.poll(() => router.state.location.pathname).toBe("/account-deleted");
  });
  it.each([
    ["a server error (500)", "INTERNAL", 500, "Something went wrong. Please try again."],
    ["RATE_LIMITED", "RATE_LIMITED", 429, "Too many attempts. Try again later."],
  ] as const)(
    "after %s, an answer, not a lost response: go to log in",
    async (_label, code, status, message) => {
      fns.deleteMyAccount
        .mockRejectedValueOnce(PublicError.from({ code, status, message }))
        .mockRejectedValueOnce(unauthenticated());
      const { router } = await renderWithRouter(<ClosePage data={deleteData} />, "/account/close");
      await userEvent.fill(page.getByLabelText("Password"), "correct horse");
      await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
      await expect.element(page.getByText(message)).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Delete my account" }));
      await expect.poll(() => router.state.location.pathname).toBe("/login");
    },
  );
});
