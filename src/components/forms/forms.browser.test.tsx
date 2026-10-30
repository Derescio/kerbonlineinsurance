import { createRef } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
import { Radio } from "./Radio";
import { RadioGroup } from "./RadioGroup";
import { Select } from "./Select";
import { Switch } from "./Switch";

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("Input", () => {
  it("ties the label to the input and links the hint", async () => {
    await render(<Input label="Postcode" hint="We use it to price your cover." optional />);
    // "(optional)" is part of the label, so it's part of the name
    const input = page.getByRole("textbox", { name: "Postcode (optional)" });
    await expect.element(input).toBeVisible();
    await expect.element(input).toHaveAccessibleDescription("We use it to price your cover.");
    await expect.element(page.getByText("(optional)")).toBeVisible();
  });

  it("replaces the hint with a linked error", async () => {
    const { container } = await render(
      <Input label="Postcode" hint="Hint text" error="Enter your postcode" />,
    );
    const input = page.getByLabelText("Postcode");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    await expect.element(input).toHaveAccessibleDescription("Enter your postcode");
    expect(container.textContent).not.toContain("Hint text");
    expect(container.querySelector(".kb-control--error")).not.toBeNull();
  });

  it("renders the plate variant with prefix and suffix", async () => {
    const { container } = await render(
      <>
        <Input variant="plate" label="Registration" />
        <Input label="Excess" prefix="£" suffix="per claim" />
      </>,
    );
    expect(container.querySelector(".kb-control--plate")).not.toBeNull();
    await expect.element(page.getByText("£")).toBeVisible();
    await expect.element(page.getByText("per claim")).toBeVisible();
  });

  it("keeps the error and disabled looks on the plate variant", async () => {
    const { container } = await render(
      <>
        <Input variant="plate" label="Registration" error="Enter a UK registration" />
        <Input variant="plate" label="Registration 2" disabled />
      </>,
    );
    const [errorPlate, disabledPlate] = container.querySelectorAll<HTMLElement>(".kb-control");
    const danger = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();
    expect(getComputedStyle(errorPlate!).borderColor).toBe(hexToRgb(danger));
    const sunken = getComputedStyle(document.documentElement)
      .getPropertyValue("--stone-100")
      .trim();
    expect(getComputedStyle(disabledPlate!).backgroundColor).toBe(hexToRgb(sunken));
  });

  it("is disabled and skipped by Tab when disabled", async () => {
    await render(
      <>
        <Input label="Name" disabled />
        <Input label="Email" />
      </>,
    );
    await expect.element(page.getByLabelText("Name")).toBeDisabled();
    await userEvent.tab();
    await expect.element(page.getByLabelText("Email")).toHaveFocus();
  });

  it("uses a passed id and forwards ref to the input", async () => {
    const ref = createRef<HTMLInputElement>();
    await render(<Input label="Email" id="email" ref={ref} />);
    expect(ref.current?.id).toBe("email");
    expect(ref.current?.tagName).toBe("INPUT");
  });
});

describe("Select", () => {
  it("shows a placeholder that isn't selectable, and isn't required by default", async () => {
    await render(
      <Select
        label="Cover"
        placeholder="Choose cover"
        options={["Third party", "Comprehensive"]}
      />,
    );
    const select = page.getByLabelText("Cover");
    await expect.element(select).toHaveValue("");
    await expect.element(select).not.toBeRequired();
    await expect.element(page.getByRole("option", { name: "Choose cover" })).toBeDisabled();
  });

  it("takes string and {value, label} options", async () => {
    await render(
      <Select
        label="Usage"
        defaultValue="sdp"
        options={[{ value: "sdp", label: "Social, domestic and pleasure" }, "Commuting"]}
      />,
    );
    await expect.element(page.getByLabelText("Usage")).toHaveValue("sdp");
    await expect.element(page.getByRole("option", { name: "Commuting" })).toBeInTheDocument();
  });

  it("links an error", async () => {
    await render(<Select label="Usage" options={["A"]} error="Choose how you use the car" />);
    await expect
      .element(page.getByLabelText("Usage"))
      .toHaveAccessibleDescription("Choose how you use the car");
  });

  it("changes value with the arrow keys", async () => {
    await render(<Select label="Doors" defaultValue="3" options={["3", "5"]} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByLabelText("Doors")).toHaveValue("5");
  });
});

describe("Checkbox", () => {
  it("toggles from its label and with Space, and reads its description", async () => {
    await render(
      <Checkbox label="Send me renewal reminders" description="By email, once a year" />,
    );
    const box = page.getByRole("checkbox", { name: "Send me renewal reminders" });
    await expect.element(box).toHaveAccessibleDescription("By email, once a year");

    await page.getByText("Send me renewal reminders").click();
    await expect.element(box).toBeChecked();

    await userEvent.keyboard(" ");
    await expect.element(box).not.toBeChecked();
  });

  it("doesn't toggle when disabled", async () => {
    await render(<Checkbox label="Agree" disabled />);
    await page.getByText("Agree").click({ force: true });
    await expect.element(page.getByRole("checkbox")).not.toBeChecked();
  });
});

describe("RadioGroup", () => {
  const payment = (error?: string) => (
    <RadioGroup legend="How do you want to pay?" error={error}>
      <Radio name="pay" value="monthly" label="Monthly" description="12 payments of £38.20" />
      <Radio name="pay" value="annual" label="Annually" description="£432.00, save £26.40" />
    </RadioGroup>
  );

  it("is a group named by its legend, with each description linked", async () => {
    await render(payment());
    await expect
      .element(page.getByRole("group", { name: "How do you want to pay?" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("radio", { name: "Monthly" }))
      .toHaveAccessibleDescription("12 payments of £38.20");
  });

  it("moves the selection with the arrow keys", async () => {
    await render(payment());
    // The native radio is visually hidden; people click the label
    await page.getByText("Monthly", { exact: true }).click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("radio", { name: "Annually" })).toBeChecked();
    await expect.element(page.getByRole("radio", { name: "Annually" })).toHaveFocus();
  });

  it("links an error to the group", async () => {
    await render(payment("Choose how you want to pay"));
    await expect
      .element(page.getByRole("group"))
      .toHaveAccessibleDescription("Choose how you want to pay");
  });
});

describe("Switch", () => {
  it("is a switch named by its label that toggles with Space", async () => {
    const { container } = await render(<Switch label="Paperless documents" labelPosition="end" />);
    const toggle = page.getByRole("switch", { name: "Paperless documents" });
    await expect.element(toggle).not.toBeChecked();
    await userEvent.tab();
    await userEvent.keyboard(" ");
    await expect.element(toggle).toBeChecked();
    expect(container.querySelector(".kb-switch--end")).not.toBeNull();
  });
});

describe("keyboard focus", () => {
  it("reaches every control with Tab and shows its focus style", async () => {
    const { container } = await render(
      <>
        <Input label="Name" />
        <Select label="Doors" options={["3", "5"]} />
        <Checkbox label="Agree" />
        <RadioGroup legend="Pay">
          <Radio name="p" value="m" label="Monthly" />
        </RadioGroup>
        <Switch label="Paperless" />
      </>,
    );
    // Inputs and selects show a halo on the control; checkboxes, radios and switches show a
    // ring on the box or track that follows the (visually hidden) native input
    const fields = container.querySelectorAll<HTMLElement>("input, select");
    expect(fields).toHaveLength(5);
    for (const field of fields) {
      await userEvent.tab();
      expect(document.activeElement).toBe(field);
      const styled = field.closest<HTMLElement>(".kb-control") ?? field.nextElementSibling!;
      expect(getComputedStyle(styled).boxShadow).not.toBe("none");
    }
  });
});
