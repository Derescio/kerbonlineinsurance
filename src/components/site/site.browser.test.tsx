import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { demoNotice, mainNav } from "./links";
import { NotFound } from "./NotFound";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SiteLayout } from "./SiteLayout";

// SiteLayout mounts the closure banner, whose server function the component project can't load
vi.mock("#/features/account/closure", () => ({
  getClosureBanner: vi.fn().mockResolvedValue(null),
  keepMyAccount: vi.fn(),
}));

const client = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("#/features/auth/auth-client", () => ({ authClient: client }));
const leave = vi.hoisted(() => ({ leaveTo: vi.fn() }));
vi.mock("#/lib/leave", () => leave);

/** The session hint's answer (6.1, decision 8); null leaves the request hanging */
function hint(signedIn: boolean | null) {
  const answer =
    signedIn === null
      ? new Promise<Response>(() => {})
      : Promise.resolve(Response.json({ signedIn }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => answer),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SiteHeader", () => {
  it("links the wordmark home and names its links", async () => {
    hint(false);
    await render(<SiteHeader />);
    await expect
      .element(page.getByRole("link", { name: "Kerb home" }))
      .toHaveAttribute("href", "/");
    await expect
      .element(page.getByRole("link", { name: "Log in" }))
      .toHaveAttribute("href", "/login");
    await expect
      .element(page.getByRole("link", { name: "Notifications" }))
      .toHaveAttribute("href", "/account/notifications");
  });

  it("has a named main nav with the four links at their paths", async () => {
    await page.viewport(1280, 800);
    await render(<SiteHeader />);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav).toBeVisible();
    for (const { label, href } of mainNav) {
      await expect.element(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the current section with aria-current", async () => {
    await page.viewport(1280, 800);
    await render(<SiteHeader pathname="/claims/track" />);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("link", { name: "Claims" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(nav.getByRole("link", { name: "Help" }))
      .not.toHaveAttribute("aria-current");
  });

  it("swaps the nav for a Menu button on mobile", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await expect.element(page.getByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Menu" })).toBeVisible();
  });
});

describe("Mobile menu", () => {
  it("opens with the nav links, closes on Escape and returns focus to Menu", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    const menu = page.getByRole("button", { name: "Menu" });
    await expect.element(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await expect.element(menu).toHaveAttribute("aria-expanded", "true");
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect.element(dialog).toBeVisible();
    for (const { label, href } of mainNav) {
      await expect.element(dialog.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(menu).toHaveAttribute("aria-expanded", "false");
    await expect.element(menu).toHaveFocus();
  });

  it("closes when a link is chosen", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    const link = dialog.getByRole("link", { name: "Help" });
    // Don't leave the test page: cancel the navigation, keep the click
    link.element().addEventListener("click", (e) => e.preventDefault());
    await link.click();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("closes with the Close button", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe("SiteFooter", () => {
  it("has four named link groups and the demo line", async () => {
    await render(<SiteFooter />);
    for (const name of ["Insurance", "Claims", "Support", "Account"]) {
      await expect.element(page.getByRole("navigation", { name })).toBeVisible();
    }
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Insurance" })
          .getByRole("link", { name: "Pet insurance" }),
      )
      .toHaveAttribute("href", "/insurance/pet");
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Insurance" })
          .getByRole("link", { name: "Business insurance" }),
      )
      .toHaveAttribute("href", "/insurance/business");
    await expect.element(page.getByRole("contentinfo").getByText(demoNotice)).toBeVisible();
  });
});

describe("SiteLayout", () => {
  it("renders the demo banner, skip link, header, main and footer", async () => {
    await render(
      <SiteLayout>
        <h1>Page</h1>
      </SiteLayout>,
    );
    await expect
      .element(page.getByRole("region", { name: "Demo notice" }))
      .toHaveTextContent(demoNotice);
    await expect.element(page.getByRole("banner")).toBeVisible();
    await expect.element(page.getByRole("main")).toHaveAttribute("id", "main");
    await expect
      .element(page.getByRole("main").getByRole("heading", { name: "Page" }))
      .toBeVisible();
    await expect.element(page.getByRole("contentinfo")).toBeVisible();
  });

  it("puts the skip link first in the Tab order", async () => {
    await render(
      <SiteLayout>
        <h1>Page</h1>
      </SiteLayout>,
    );
    await userEvent.tab();
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect.element(skip).toHaveFocus();
    await expect.element(skip).toHaveAttribute("href", "#main");
    await expect.element(skip).toBeVisible();
  });
});

describe("NotFound", () => {
  it("says the page isn't built yet, inside the site chrome, with a link home", async () => {
    await render(<NotFound />);
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This page isn't built yet");
    await expect.element(page.getByRole("banner")).toBeVisible();
    await expect.element(page.getByRole("contentinfo")).toBeVisible();
    await expect
      .element(page.getByRole("main").getByRole("link", { name: /home/i }))
      .toHaveAttribute("href", "/");
  });
});

describe("SiteHeader: My account when signed in (6.1, decision 8)", () => {
  it("shows Log in while the hint hasn't answered", async () => {
    hint(null);
    await render(<SiteHeader />);
    await expect.element(page.getByRole("link", { name: "Log in" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/session-hint", expect.anything());
  });

  it("keeps Log in when nobody is signed in, or the hint fails", async () => {
    hint(false);
    await render(<SiteHeader />);
    await expect.element(page.getByRole("link", { name: "Log in" })).toBeVisible();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await render(<SiteHeader />);
    await expect.element(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  });

  it("offers My account, with Overview and Log out, when signed in", async () => {
    await page.viewport(1280, 800);
    hint(true);
    await render(<SiteHeader />);
    const button = page.getByRole("button", { name: "My account" });
    await expect.element(button).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Log in" })).not.toBeInTheDocument();

    await userEvent.click(button);
    await expect.element(button).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(page.getByRole("link", { name: "Overview" }))
      .toHaveAttribute("href", "/account");
    await userEvent.keyboard("{Escape}");
    await expect.element(button).toHaveAttribute("aria-expanded", "false");
    await expect.element(button).toHaveFocus();
  });

  it("logs out from the menu, then goes home", async () => {
    await page.viewport(1280, 800);
    hint(true);
    client.signOut.mockResolvedValue({});
    await render(<SiteHeader />);
    await userEvent.click(page.getByRole("button", { name: "My account" }));
    await userEvent.click(page.getByRole("button", { name: "Log out" }));
    await expect.poll(() => leave.leaveTo.mock.calls).toEqual([["/"]]);
    expect(client.signOut).toHaveBeenCalled();
  });

  it("doesn't change the account slot's width when the answer arrives", async () => {
    await page.viewport(1280, 800);
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const { container } = await render(<SiteHeader />);
    const slot = container.querySelector<HTMLElement>(".site-header__account")!;
    const before = slot.offsetWidth;
    answer(Response.json({ signedIn: true }));
    await expect.element(page.getByRole("button", { name: "My account" })).toBeVisible();
    expect(slot.offsetWidth).toBe(before);
  });

  it("lists Overview and Log out in the mobile menu when signed in", async () => {
    await page.viewport(390, 800);
    hint(true);
    await render(<SiteHeader />);
    await userEvent.click(page.getByRole("button", { name: "Menu" }));
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect
      .element(sheet.getByRole("link", { name: "Overview" }))
      .toHaveAttribute("href", "/account");
    await expect.element(sheet.getByRole("button", { name: "Log out" })).toBeVisible();
  });
});
