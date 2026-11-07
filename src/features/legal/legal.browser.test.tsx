import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { attachPosthog } from "#/lib/analytics";
import { PRIVACY_EMAIL, RETENTION } from "#/server/account/constants";

import { CookiesPage } from "./CookiesPage";
import { COOKIES } from "./cookies";
import { PrivacyNotice } from "./PrivacyNotice";

describe("PrivacyNotice", () => {
  it("names the controller and its contact as a mailto link", async () => {
    await render(<PrivacyNotice />);
    await expect.element(page.getByRole("heading", { level: 1, name: /privacy/i })).toBeVisible();
    await expect.element(page.getByText("OpsEd Solutions", { exact: false }).first()).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: PRIVACY_EMAIL }).first())
      .toHaveAttribute("href", `mailto:${PRIVACY_EMAIL}`);
  });

  it("names every processor and where", async () => {
    await render(<PrivacyNotice />);
    for (const name of ["Vercel", "Neon", "Resend", "PostHog", "Google", "Cloudflare"]) {
      await expect
        .element(page.getByRole("cell", { name: new RegExp(name) }).first())
        .toBeVisible();
    }
    await expect.element(page.getByText("London", { exact: false }).first()).toBeVisible();
    await expect.element(page.getByText("United States", { exact: false }).first()).toBeVisible();
  });

  it("builds the retention table from RETENTION and labels it illustrative", async () => {
    await render(<PrivacyNotice />);
    const table = page.getByRole("table", { name: /how long we keep/i });
    await expect.element(table).toBeVisible();
    await expect
      .element(table.getByText(`${RETENTION.insuranceRecordsYears} years`, { exact: false }))
      .toBeVisible();
    await expect
      .element(table.getByText(`${RETENTION.securityEventsMonths} months`, { exact: false }))
      .toBeVisible();
    await expect.element(page.getByText(/illustrative/i).first()).toBeVisible();
  });

  it("links to closing the account and to the cookies page, the ICO, and says when it changed", async () => {
    await render(<PrivacyNotice />);
    await expect
      .element(page.getByRole("link", { name: /close your account/i }))
      .toHaveAttribute("href", "/account/close");
    await expect
      .element(page.getByRole("link", { name: /cookies page/i }).first())
      .toHaveAttribute("href", "/cookies");
    await expect
      .element(page.getByRole("link", { name: /ICO|Information Commissioner/ }).first())
      .toHaveAttribute("href", "https://ico.org.uk/make-a-complaint/");
    await expect.element(page.getByText(/Last updated/)).toBeVisible();
  });
});

describe("CookiesPage", () => {
  it("lists one row per cookie", async () => {
    await render(<CookiesPage />);
    const table = page.getByRole("table", { name: /cookies/i });
    for (const cookie of COOKIES) {
      await expect
        .element(table.getByRole("cell", { name: cookie.name, exact: true }))
        .toBeVisible();
    }
    expect(table.getByRole("row").elements()).toHaveLength(COOKIES.length + 1);
    await expect.element(table.getByText("30 days", { exact: false })).toBeVisible();
  });

  it("says when PostHog isn't running, in place of the button", async () => {
    attachPosthog(undefined);
    await render(<CookiesPage />);
    await expect
      .element(page.getByRole("button", { name: "Cookie settings" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(/analytics isn.t running/i)).toBeVisible();
  });

  it("reopens the consent bar from the Cookie settings button", async () => {
    const client = {
      get_explicit_consent_status: () => "granted",
      clear_opt_in_out_capturing: vi.fn(),
      stopSessionRecording: vi.fn(),
      startSessionRecording: vi.fn(),
      onFeatureFlags: vi.fn(() => () => {}),
      capture: vi.fn(),
    };
    attachPosthog(client as never);
    await render(<CookiesPage />);
    await page.getByRole("button", { name: "Cookie settings" }).click();
    expect(client.clear_opt_in_out_capturing).toHaveBeenCalledOnce();
    attachPosthog(undefined);
  });
});
