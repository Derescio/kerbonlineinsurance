import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { icons } from "#/components/display/icons";
import { Toaster } from "#/components/feedback/Toaster";

import { allTokens } from "./foundations";
import { sections } from "./parts";
import { SystemPage } from "./SystemPage";
import "./system.css";

const renderPage = () =>
  render(
    <Toaster>
      <SystemPage />
    </Toaster>,
  );

describe("/system", () => {
  it("renders all eight sections, each linked from the section nav, without errors", async () => {
    const error = vi.spyOn(console, "error");
    await renderPage();
    const nav = page.getByRole("navigation", { name: "Design system sections" });
    for (const { id, title } of sections) {
      await expect.element(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
      await expect
        .element(nav.getByRole("link", { name: title }))
        .toHaveAttribute("href", `#${id}`);
    }
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("lists only tokens that exist in the loaded CSS", async () => {
    await renderPage();
    const root = getComputedStyle(document.documentElement);
    const missing = allTokens.filter((t) => root.getPropertyValue(t).trim() === "");
    expect(missing).toEqual([]);
  });

  it("shows every icon in the registry", async () => {
    const { container } = await renderPage();
    const shown = [...container.querySelectorAll("#icons code")].map((c) => c.textContent);
    expect(shown).toEqual(Object.keys(icons));
  });

  it("has working demos: toast, dialog and plan selection", async () => {
    const { container } = await renderPage();

    await page.getByRole("button", { name: "Show a toast" }).click();
    const polite = container.querySelector('[aria-live="polite"]')!;
    await expect.poll(() => polite.textContent).toContain("Details saved");

    await page.getByRole("button", { name: "Open dialog" }).click();
    const modal = container.querySelector<HTMLDialogElement>("dialog")!;
    await expect.poll(() => modal.matches(":modal")).toBe(true);
    modal.querySelector<HTMLButtonElement>(".kb-dialog__close")!.click();
    await expect.poll(() => modal.open).toBe(false);

    const tp = page.getByRole("radio", { name: "Third party", exact: true });
    await tp.click();
    await expect.element(tp).toHaveAttribute("aria-checked", "true");
  });
});
