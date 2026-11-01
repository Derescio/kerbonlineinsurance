import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { getFlag } from "#/lib/analytics";

import { ctaLabels, Hero } from "./Hero";

// The flag's own rules (consent, timeout, PostHog not configured) are tested in
// src/lib/analytics.test.ts. Here getFlag is stubbed to check what the hero does with the answer.
vi.mock("#/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/analytics")>()),
  getFlag: vi.fn(),
}));

const flag = vi.mocked(getFlag);
// The submit button is the hero's only button
const cta = () => page.getByRole("button");

afterEach(() => {
  flag.mockReset();
});

describe("Hero CTA experiment", () => {
  it("shows the control while flags load, and asks for the right flag", async () => {
    flag.mockReturnValue(new Promise(() => {}));
    await render(<Hero />);
    await expect.element(cta()).toHaveAccessibleName(ctaLabels.control);
    expect(flag).toHaveBeenCalledWith("hero-cta-copy");
  });

  it("swaps to the test label for a visitor in that variant", async () => {
    flag.mockResolvedValue("see-my-price");
    await render(<Hero />);
    await expect.element(cta()).toHaveAccessibleName(ctaLabels["see-my-price"]);
  });

  it.each([undefined, "control", "unknown-variant", true])(
    "keeps the control when the flag is %s",
    async (value) => {
      flag.mockResolvedValue(value);
      await render(<Hero />);
      await expect.element(cta()).toHaveAccessibleName(ctaLabels.control);
    },
  );

  it("keeps the button the same width whichever label shows", async () => {
    let answer: (value: string) => void = () => {};
    flag.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(<Hero />);
    const before = cta().element().getBoundingClientRect().width;

    answer("see-my-price");
    await expect.element(cta()).toHaveAccessibleName(ctaLabels["see-my-price"]);
    expect(cta().element().getBoundingClientRect().width).toBe(before);
  });
});
