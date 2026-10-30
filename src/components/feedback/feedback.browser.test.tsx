import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Button } from "#/components/actions/Button";

import { Alert } from "./Alert";
import { Dialog, type DialogProps } from "./Dialog";
import { Toaster, useToast, type ToastInput } from "./Toaster";
import { Tooltip } from "./Tooltip";

describe("Alert", () => {
  it("has no live role unless asked to announce", async () => {
    const { container } = await render(<Alert title="Your policy renews soon">Text</Alert>);
    expect(container.querySelector("[role]")).toBeNull();
  });

  it("announces as alert for danger and status otherwise", async () => {
    await render(
      <>
        <Alert tone="danger" announce title="Payment failed" />
        <Alert tone="success" announce title="Saved" />
      </>,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("Payment failed");
    await expect.element(page.getByRole("status")).toHaveTextContent("Saved");
  });

  it("sets the tone class and renders title, body and action", async () => {
    const { container } = await render(
      <Alert tone="warning" title="Check your details" action={<Button size="sm">Review</Button>}>
        Your address looks incomplete.
      </Alert>,
    );
    expect(container.querySelector(".kb-alert--warning")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".kb-alert__body")!.textContent).toContain(
      "Your address looks incomplete.",
    );
    await expect.element(page.getByRole("button", { name: "Review" })).toBeVisible();
  });
});

describe("Tooltip", () => {
  it("describes its trigger, shows on focus and hides on Escape", async () => {
    const { container } = await render(
      <Tooltip content="What you pay towards a claim">excess</Tooltip>,
    );
    const trigger = page.getByRole("button", { name: "excess" });
    await expect.element(trigger).toHaveAccessibleDescription("What you pay towards a claim");

    const bubble = container.querySelector<HTMLElement>(".kb-tip__bubble")!;
    await userEvent.tab();
    await expect.poll(() => getComputedStyle(bubble).opacity).toBe("1");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => getComputedStyle(bubble).opacity).toBe("0");
  });

  it("supports bottom placement", async () => {
    const { container } = await render(
      <Tooltip content="Help" placement="bottom">
        term
      </Tooltip>,
    );
    expect(container.querySelector(".kb-tip--bottom")).not.toBeNull();
  });
});

function ToastButton({ toast }: { toast: ToastInput }) {
  const show = useToast();
  return <button onClick={() => show(toast)}>Show</button>;
}

describe("Toaster", () => {
  it("shows a toast inside the polite live region, then removes it after its duration", async () => {
    const { container } = await render(
      <Toaster>
        <ToastButton toast={{ title: "Details saved", duration: 300 }} />
      </Toaster>,
    );
    await page.getByRole("button", { name: "Show" }).click();
    const polite = container.querySelector('[aria-live="polite"]')!;
    await expect.poll(() => polite.textContent).toContain("Details saved");
    await expect.poll(() => polite.textContent, { timeout: 2000 }).toBe("");
  });

  it("keeps danger toasts in the assertive region until dismissed", async () => {
    const { container } = await render(
      <Toaster>
        <ToastButton toast={{ tone: "danger", title: "Payment failed", duration: 100 }} />
      </Toaster>,
    );
    await page.getByRole("button", { name: "Show" }).click();
    const assertive = container.querySelector('[aria-live="assertive"]')!;
    await expect.poll(() => assertive.textContent).toContain("Payment failed");
    await new Promise((r) => setTimeout(r, 400));
    expect(assertive.textContent).toContain("Payment failed");

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect.poll(() => assertive.textContent).toBe("");
  });

  it("runs the action and then dismisses", async () => {
    const onAction = vi.fn();
    await render(
      <Toaster>
        <ToastButton toast={{ title: "Driver removed", actionLabel: "Undo", onAction }} />
      </Toaster>,
    );
    await page.getByRole("button", { name: "Show" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
    await expect.element(page.getByText("Driver removed")).not.toBeInTheDocument();
  });

  it("throws a clear error without a Toaster", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(render(<ToastButton toast={{}} />)).rejects.toThrow(/needs a <Toaster>/);
    error.mockRestore();
  });
});

/** Opener button + dialog with real open/close state. */
function DialogHarness(props: Partial<DialogProps> & { dismissable?: boolean }) {
  const { dismissable = true, ...rest } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Cancel policy</button>
      <Dialog
        title="Cancel your policy?"
        description="Your cover ends at midnight."
        actions={<Button onClick={() => setOpen(false)}>Keep my cover</Button>}
        {...rest}
        open={open}
        onClose={dismissable ? () => setOpen(false) : undefined}
      />
    </>
  );
}

describe("Dialog", () => {
  it("opens as a modal named by its title and described by its description", async () => {
    await render(<DialogHarness />);
    await page.getByRole("button", { name: "Cancel policy" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel your policy?" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveAccessibleDescription("Your cover ends at midnight.");
    expect((dialog.element() as HTMLDialogElement).matches(":modal")).toBe(true);
  });

  it("keeps focus inside and returns it to the opener on Escape", async () => {
    await render(<DialogHarness />);
    const opener = page.getByRole("button", { name: "Cancel policy" });
    await opener.click();
    const dialog = page.getByRole("dialog").element();
    await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);

    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      // Tab may pass through the browser chrome; it never lands on the page behind the dialog
      expect(document.activeElement === opener.element()).toBe(false);
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });

  it("closes from the close button and the scrim", async () => {
    await render(<DialogHarness />);
    const opener = page.getByRole("button", { name: "Cancel policy" });

    await opener.click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();

    await opener.click();
    const scrim = page.getByRole("dialog").element();
    scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open on Escape when it has no onClose", async () => {
    await render(<DialogHarness dismissable={false} />);
    await page.getByRole("button", { name: "Cancel policy" }).click();
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("renders a sheet without a close button", async () => {
    const { container } = await render(<DialogHarness presentation="sheet" />);
    await page.getByRole("button", { name: "Cancel policy" }).click();
    expect(container.querySelector(".kb-dialog-scrim--sheet")).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("renders a non-modal contained preview", async () => {
    await render(<Dialog open contained title="Preview" />);
    const dialog = page.getByRole("dialog", { name: "Preview" });
    await expect.element(dialog).toBeVisible();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
