import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Badge } from "./Badge";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { Tag } from "./Tag";
import { Wordmark } from "./Wordmark";

describe("Icon", () => {
  it("renders an SVG at the given size, hidden from assistive tech", async () => {
    const { container } = await render(<Icon name="car" size={24} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.classList.contains("kb-icon")).toBe(true);
  });

  it("is an image with a name when labelled", async () => {
    await render(<Icon name="shield-check" label="Covered" />);
    await expect.element(page.getByRole("img", { name: "Covered" })).toBeVisible();
  });
});

describe("Badge", () => {
  it.each(["brand", "success", "warning", "danger", "info", "accent", "inverse"] as const)(
    "sets the %s tone class",
    async (tone) => {
      await render(<Badge tone={tone}>Active</Badge>);
      await expect.element(page.getByText("Active")).toHaveClass(`kb-badge--${tone}`);
    },
  );

  it("adds no modifier for neutral, and a hidden dot when asked", async () => {
    const { container } = await render(<Badge dot>Pending</Badge>);
    const badge = container.querySelector(".kb-badge")!;
    expect(badge.className).toBe("kb-badge");
    expect(badge.querySelector(".kb-badge__dot")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Card", () => {
  it.each(["raised", "outline", "sunken", "inverse"] as const)(
    "sets the %s variant",
    async (variant) => {
      const { container } = await render(<Card variant={variant}>Policy</Card>);
      expect(container.querySelector(".kb-card")!.classList.contains(`kb-card--${variant}`)).toBe(
        true,
      );
    },
  );

  it("sets padding, interactive and the element", async () => {
    const { container } = await render(
      <Card as="article" padding="lg" interactive>
        Claim
      </Card>,
    );
    const card = container.querySelector(".kb-card")!;
    expect(card.tagName).toBe("ARTICLE");
    expect(card.classList.contains("kb-card--pad-lg")).toBe(true);
    expect(card.classList.contains("kb-card--interactive")).toBe(true);
  });
});

describe("Wordmark", () => {
  it("is announced once as Kerb", async () => {
    await render(<Wordmark />);
    await expect.element(page.getByRole("img", { name: "Kerb" })).toBeVisible();
  });

  it("includes the descriptor in the name and supports the inverse tone", async () => {
    await render(<Wordmark tone="inverse" descriptor="car insurance" />);
    const mark = page.getByRole("img", { name: "Kerb car insurance" });
    await expect.element(mark).toHaveClass("kb-wordmark--inverse");
    await expect.element(page.getByText("car insurance")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Tag", () => {
  it("is a toggle button whose pressed state follows selected", async () => {
    const onClick = vi.fn();
    const { rerender } = await render(<Tag onClick={onClick}>Comprehensive</Tag>);
    const tag = page.getByRole("button", { name: "Comprehensive" });
    await expect.element(tag).toHaveAttribute("aria-pressed", "false");

    await tag.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    await rerender(
      <Tag onClick={onClick} selected>
        Comprehensive
      </Tag>,
    );
    await expect.element(tag).toHaveAttribute("aria-pressed", "true");
    await expect.element(tag).toHaveClass("kb-tag--selected");
  });

  it("toggles with Enter and Space", async () => {
    const onClick = vi.fn();
    await render(<Tag onClick={onClick}>Third party</Tag>);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("has a separately labelled remove button", async () => {
    const onRemove = vi.fn();
    await render(<Tag onRemove={onRemove}>Under 25</Tag>);
    await page.getByRole("button", { name: "Remove Under 25" }).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
    // The tag itself isn't a control, so nothing interactive is nested
    expect(page.getByRole("button").all()).toHaveLength(1);
  });
});
