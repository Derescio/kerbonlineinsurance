import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { CoverageGroup, type CoverageChoice } from "./CoverageGroup";
import { Timeline } from "./Timeline";

const plans: CoverageChoice[] = [
  {
    id: "tp",
    name: "Third party",
    price: "£28.10",
    features: ["Damage to others", { label: "Damage to your car", included: false }],
  },
  {
    id: "tpft",
    name: "Third party, fire and theft",
    price: "£31.60",
    features: ["Damage to others", "Fire and theft"],
  },
  {
    id: "comp",
    name: "Comprehensive",
    description: "Our fullest cover",
    price: "£38.20",
    flag: "Most chosen",
    features: ["Damage to others", "Fire and theft", "Damage to your car"],
  },
];

function Plans({
  initial = null,
  onChange,
}: {
  initial?: string | null;
  onChange?: (id: string) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <CoverageGroup
      label="Choose your cover"
      options={plans}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

describe("CoverageGroup", () => {
  it("is a radiogroup named by its label, with one card in the Tab order", async () => {
    await render(<Plans />);
    await expect.element(page.getByRole("radiogroup", { name: "Choose your cover" })).toBeVisible();
    const radios = page.getByRole("radio").all();
    expect(radios.map((r) => r.element().getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("names each card by its plan and describes it with flag, price and features", async () => {
    await render(<Plans />);
    const comp = page.getByRole("radio", { name: "Comprehensive" });
    await expect.element(comp).toHaveAccessibleDescription(/Most chosen/);
    await expect.element(comp).toHaveAccessibleDescription(/£38\.20/);
    await expect.element(comp).toHaveAccessibleDescription(/Damage to your car/);
    await expect
      .element(page.getByRole("radio", { name: "Third party", exact: true }))
      .toHaveAccessibleDescription(/Not included: Damage to your car/);
  });

  it("moves and selects with the arrow keys, wrapping", async () => {
    const onChange = vi.fn();
    await render(<Plans initial="tp" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    const tpft = page.getByRole("radio", { name: "Third party, fire and theft" });
    await expect.element(tpft).toHaveAttribute("aria-checked", "true");
    await expect.element(tpft).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect
      .element(page.getByRole("radio", { name: "Third party", exact: true }))
      .toHaveAttribute("aria-checked", "true");

    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(page.getByRole("radio", { name: "Comprehensive" }))
      .toHaveAttribute("aria-checked", "true");
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["tpft", "comp", "tp", "comp"]);
  });

  it("selects with Space and with a click", async () => {
    await render(<Plans />);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    await expect
      .element(page.getByRole("radio", { name: "Third party", exact: true }))
      .toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "Comprehensive" }).click();
    await expect
      .element(page.getByRole("radio", { name: "Comprehensive" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("radio", { name: "Comprehensive" }))
      .toHaveClass("kb-cover--selected");
  });
});

describe("Timeline", () => {
  it("renders items in order with status text and the current step marked", async () => {
    const { container } = await render(
      <Timeline
        items={[
          { title: "Claim submitted", meta: "Mon 12 Oct, 09:12", status: "done" },
          { title: "Assessor assigned", meta: "Today", status: "current", description: "Priya" },
          { title: "Repair booked" },
        ]}
      />,
    );
    const items = [...container.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "Done: Claim submittedMon 12 Oct, 09:12",
      "In progress: Assessor assignedTodayPriya",
      "Next: Repair booked",
    ]);
    expect(items[1]!.getAttribute("aria-current")).toBe("step");
    expect(items[0]!.querySelector("svg")).not.toBeNull();
  });
});
