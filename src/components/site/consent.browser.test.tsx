import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { attachPosthog, type ConsentStatus } from "#/lib/analytics";

import { ConsentBanner } from "./ConsentBanner";
import { SiteLayout } from "./SiteLayout";

/** Just enough of a PostHog client for the consent calls, keeping the choice in memory. */
function fakePosthog(initial: ConsentStatus) {
  let status = initial;
  const client = {
    get_explicit_consent_status: () => status,
    opt_in_capturing: vi.fn(() => {
      status = "granted";
    }),
    opt_out_capturing: vi.fn(() => {
      status = "denied";
    }),
    clear_opt_in_out_capturing: vi.fn(() => {
      status = "pending";
    }),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  };
  return client;
}

type FakePosthog = ReturnType<typeof fakePosthog>;

afterEach(() => attachPosthog(undefined));

function renderSite(client: FakePosthog, { load = true } = {}) {
  if (load) attachPosthog(client);
  return render(
    <>
      <SiteLayout>
        <p>Page</p>
      </SiteLayout>
      <ConsentBanner />
    </>,
  );
}

const bar = page.getByRole("region", { name: "Cookie choices" });

describe("ConsentBanner", () => {
  it("asks a visitor who hasn't chosen, with equal Accept and Reject and a policy link", async () => {
    await renderSite(fakePosthog("pending"));
    await expect.element(bar).toBeVisible();
    const accept = bar.getByRole("button", { name: "Accept cookies" });
    const reject = bar.getByRole("button", { name: "Reject cookies" });
    await expect.element(accept).toHaveClass("kb-btn--secondary");
    await expect.element(reject).toHaveClass("kb-btn--secondary");
    await expect
      .element(bar.getByRole("link", { name: "Cookie policy" }))
      .toHaveAttribute("href", "/cookies");
  });

  it("doesn't ask again once the visitor has chosen", async () => {
    await renderSite(fakePosthog("granted"));
    await expect.element(page.getByText("Page")).toBeVisible();
    await expect.element(bar).not.toBeInTheDocument();
  });

  it("stays hidden until PostHog has loaded, so the server HTML has no bar", async () => {
    const client = fakePosthog("pending");
    await renderSite(client, { load: false });
    await expect.element(page.getByText("Page")).toBeVisible();
    await expect.element(bar).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Cookie settings" }))
      .not.toBeInTheDocument();

    attachPosthog(client);
    await expect.element(bar).toBeVisible();
  });

  it("Accept opts in, starts replay, hides the bar and moves focus to main", async () => {
    const client = fakePosthog("pending");
    await renderSite(client);
    await bar.getByRole("button", { name: "Accept cookies" }).click();
    expect(client.opt_in_capturing).toHaveBeenCalledOnce();
    expect(client.startSessionRecording).toHaveBeenCalledOnce();
    await expect.element(bar).not.toBeInTheDocument();
    await expect.element(page.getByRole("main")).toHaveFocus();
  });

  it("Reject opts out without starting replay, hides the bar and moves focus to main", async () => {
    const client = fakePosthog("pending");
    await renderSite(client);
    await bar.getByRole("button", { name: "Reject cookies" }).click();
    expect(client.opt_out_capturing).toHaveBeenCalledOnce();
    expect(client.startSessionRecording).not.toHaveBeenCalled();
    await expect.element(bar).not.toBeInTheDocument();
    await expect.element(page.getByRole("main")).toHaveFocus();
  });

  it("resumes replay on load for a visitor who accepted before", () => {
    const client = fakePosthog("granted");
    attachPosthog(client);
    expect(client.startSessionRecording).toHaveBeenCalledOnce();
  });
});

describe("Cookie settings", () => {
  it("clears the choice, stops replay and shows the bar again", async () => {
    const client = fakePosthog("granted");
    await renderSite(client);
    await page.getByRole("button", { name: "Cookie settings" }).click();
    expect(client.stopSessionRecording).toHaveBeenCalledOnce();
    expect(client.clear_opt_in_out_capturing).toHaveBeenCalledOnce();
    await expect.element(bar).toBeVisible();
  });
});
