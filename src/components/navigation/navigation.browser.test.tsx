import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Stepper } from "./Stepper";
import { TabPanel, Tabs } from "./Tabs";

const steps = ["Vehicle", "Driving", "Driver details", "Coverage", "Quote summary"];

describe("Stepper", () => {
  it("is a named list with the current step marked and done steps said", async () => {
    const { container } = await render(
      <Stepper steps={steps} current={2} label="Quote progress" />,
    );
    await expect.element(page.getByRole("navigation", { name: "Quote progress" })).toBeVisible();
    const items = [...container.querySelectorAll("li.kb-step")];
    expect(items.map((li) => li.textContent)).toEqual([
      "Vehicle (completed)",
      "Driving (completed)",
      "3Driver details",
      "4Coverage",
      "5Quote summary",
    ]);
    expect(items[2]!.getAttribute("aria-current")).toBe("step");
  });

  it("hides the other labels in compact only visually", async () => {
    const { container } = await render(<Stepper steps={steps} current={1} variant="compact" />);
    const label = container.querySelector<HTMLElement>(".kb-step--upcoming .kb-step__label")!;
    expect(label.classList.contains("kb-sr-only")).toBe(true);
    expect(getComputedStyle(label).display).not.toBe("none");
    expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("renders the bar as a named progressbar", async () => {
    await render(<Stepper steps={steps} current={1} variant="bar" label="Quote progress" />);
    const bar = page.getByRole("progressbar", { name: "Quote progress" });
    await expect.element(bar).toHaveAttribute("aria-valuenow", "2");
    await expect.element(bar).toHaveAttribute("aria-valuemax", "5");
    await expect.element(bar).toHaveAttribute("aria-valuetext", "Step 2 of 5: Driving");
  });
});

function PolicyTabs({ onChange }: { onChange?: (id: string) => void }) {
  const [tab, setTab] = useState("overview");
  return (
    <>
      <Tabs
        id="policy"
        label="Policy sections"
        value={tab}
        onChange={(id) => {
          setTab(id);
          onChange?.(id);
        }}
        items={["overview", { id: "documents", label: "Documents", count: 4 }, "drivers"]}
      />
      <TabPanel tabsId="policy" value={tab}>
        Panel {tab}
      </TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("puts only the selected tab in the Tab order and links tab and panel", async () => {
    await render(<PolicyTabs />);
    await expect.element(page.getByRole("tablist", { name: "Policy sections" })).toBeVisible();
    const tabs = page.getByRole("tab").all();
    expect(tabs.map((t) => t.element().getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    const panel = page.getByRole("tabpanel", { name: "overview" });
    await expect.element(panel).toHaveTextContent("Panel overview");
    await expect
      .element(page.getByRole("tab", { name: "overview" }))
      .toHaveAttribute("aria-controls", panel.element().id);
  });

  it("moves and selects with the arrow keys, Home and End", async () => {
    const onChange = vi.fn();
    await render(<PolicyTabs onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("tab", { name: /Documents/ })).toHaveFocus();
    await expect.element(page.getByRole("tabpanel")).toHaveTextContent("Panel documents");

    await userEvent.keyboard("{End}");
    await expect
      .element(page.getByRole("tab", { name: "drivers" }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("tab", { name: "overview" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{Home}");
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      "documents",
      "drivers",
      "overview",
      "drivers",
      "overview",
    ]);
  });

  it("shows the count and the pill variant", async () => {
    const { container } = await render(
      <Tabs
        id="t"
        label="View"
        value="a"
        onChange={() => {}}
        variant="pill"
        fullWidth
        items={["a", { id: "b", label: "B", count: 2 }]}
      />,
    );
    expect(container.querySelector(".kb-tabs--pill.kb-tabs--full")).not.toBeNull();
    await expect.element(page.getByText("2")).toHaveClass("kb-tab__count");
  });
});
