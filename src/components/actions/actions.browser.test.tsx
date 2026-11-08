import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Tag } from "#/components/display/Tag";

import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it.each(["primary", "accent", "secondary", "ghost", "danger"] as const)(
    "sets the %s variant",
    async (variant) => {
      await render(<Button variant={variant}>Continue</Button>);
      await expect.element(page.getByRole("button")).toHaveClass(`kb-btn--${variant}`);
    },
  );

  it.each(["sm", "md", "lg"] as const)("sets the %s size", async (size) => {
    await render(<Button size={size}>Continue</Button>);
    await expect.element(page.getByRole("button")).toHaveClass(`kb-btn--${size}`);
  });

  it("defaults to type=button and fires once per click", async () => {
    const onClick = vi.fn();
    await render(<Button onClick={onClick}>Get a quote</Button>);
    const button = page.getByRole("button", { name: "Get a quote" });
    await expect.element(button).toHaveAttribute("type", "button");
    await button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("doesn't fire when disabled", async () => {
    const onClick = vi.fn();
    await render(
      <Button onClick={onClick} disabled>
        Pay
      </Button>,
    );
    await page.getByRole("button").click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner, keeps the label and doesn't fire while loading", async () => {
    const onClick = vi.fn();
    const { container } = await render(
      <Button onClick={onClick} iconLeft="download" loading>
        Policy documents
      </Button>,
    );
    const button = page.getByRole("button", { name: "Policy documents" });
    await expect.element(button).toBeDisabled();
    await expect.element(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".kb-spinner")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    await button.click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays at full colour while loading, so it reads as working, not switched off", async () => {
    await render(
      <>
        <Button loading>Working</Button>
        <Button disabled>Unavailable</Button>
      </>,
    );
    const working = page.getByRole("button", { name: "Working" }).element();
    const unavailable = page.getByRole("button", { name: "Unavailable" }).element();
    expect(getComputedStyle(working).opacity).toBe("1");
    expect(getComputedStyle(working).cursor).toBe("progress");
    expect(Number(getComputedStyle(unavailable).opacity)).toBeLessThan(1);
  });

  it("says what it's doing with loadingLabel, and keeps the label otherwise", async () => {
    const { rerender } = await render(
      <Button loadingLabel="Requesting closure…">Request account closure</Button>,
    );
    await expect.element(page.getByRole("button")).toHaveTextContent("Request account closure");
    await rerender(
      <Button loading loadingLabel="Requesting closure…">
        Request account closure
      </Button>,
    );
    await expect.element(page.getByRole("button")).toHaveTextContent("Requesting closure…");
  });

  it("renders the icons it is given", async () => {
    const { container } = await render(
      <Button iconLeft="plus" iconRight="arrow-right">
        Add a driver
      </Button>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});

describe("IconButton", () => {
  it("takes its accessible name from label", async () => {
    await render(<IconButton icon="menu" label="Open menu" />);
    await expect.element(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  it.each(["ghost", "secondary", "primary", "inverse"] as const)(
    "sets the %s variant",
    async (variant) => {
      await render(<IconButton icon="x" label="Close" variant={variant} />);
      await expect.element(page.getByRole("button")).toHaveClass(`kb-iconbtn--${variant}`);
    },
  );

  it("adds a size class only off the default", async () => {
    await render(<IconButton icon="x" label="Close" size="lg" />);
    await expect.element(page.getByRole("button")).toHaveClass("kb-iconbtn--lg");
  });

  it("doesn't fire when disabled", async () => {
    const onClick = vi.fn();
    await render(<IconButton icon="x" label="Close" onClick={onClick} disabled />);
    await page.getByRole("button").click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("keyboard focus", () => {
  it.each([
    ["Button", <Button key="b">Continue</Button>],
    ["IconButton", <IconButton key="i" icon="menu" label="Open menu" />],
    [
      "Tag",
      <Tag key="t" onClick={() => {}}>
        Comprehensive
      </Tag>,
    ],
  ])("%s is reachable with Tab and shows a focus ring", async (_name, element) => {
    await render(element);
    await userEvent.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe("BUTTON");
    expect(getComputedStyle(focused).boxShadow).not.toBe("none");
  });
});
