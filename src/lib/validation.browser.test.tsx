import { useRef, useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Input } from "#/components/forms/Input";

import { focusFirstError, type ValidationFailure } from "./validation";

function TestForm({ failure }: { failure: ValidationFailure }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} noValidate>
      {message ? <p role="alert">{message}</p> : null}
      <Input
        label="Registration"
        id="vehicle.registration"
        error={errors["vehicle.registration"]}
      />
      <Input
        label="Date of birth"
        id="drivers.0.dateOfBirth"
        error={errors["drivers.0.dateOfBirth"]}
      />
      <button
        type="button"
        onClick={() => {
          setErrors(failure.fields);
          setMessage(Object.keys(failure.fields).length === 0 ? failure.message : null);
          focusFirstError(ref.current);
        }}
      >
        Apply
      </button>
    </form>
  );
}

describe("server validation failure in a form", () => {
  it("marks, describes and focuses dotted-path fields", async () => {
    await render(
      <TestForm
        failure={{
          code: "VALIDATION",
          message: "Check the highlighted fields.",
          fields: {
            "vehicle.registration": "Enter the registration.",
            "drivers.0.dateOfBirth": "Enter a date of birth.",
          },
        }}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "Apply" }));
    const reg = page.getByLabelText("Registration");
    const dob = page.getByLabelText("Date of birth");
    await expect.element(reg).toHaveAttribute("aria-invalid", "true");
    await expect.element(dob).toHaveAttribute("aria-invalid", "true");
    await expect.element(reg).toHaveAccessibleDescription("Enter the registration.");
    await expect.element(dob).toHaveAccessibleDescription("Enter a date of birth.");
    await expect.poll(() => document.activeElement?.id).toBe("vehicle.registration");
  });

  it("shows a root message when there are no field errors", async () => {
    await render(
      <TestForm failure={{ code: "VALIDATION", message: "This quote has expired.", fields: {} }} />,
    );
    await userEvent.click(page.getByRole("button", { name: "Apply" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("This quote has expired.");
    await expect.element(page.getByLabelText("Registration")).not.toHaveAttribute("aria-invalid");
    await expect.element(page.getByLabelText("Date of birth")).not.toHaveAttribute("aria-invalid");
  });
});
