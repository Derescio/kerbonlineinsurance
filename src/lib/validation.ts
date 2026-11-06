import { z } from "zod";

// The validation-error contract shared by forms and write server functions: zod issues become
// plain sentences keyed by field path, and nothing the user typed is echoed back.

export interface ValidationFailure {
  code: "VALIDATION";
  message: string;
  fields: Record<string, string>;
}

export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: ValidationFailure };

export const CHECK_FIELDS = "Check the highlighted fields.";

/**
 * Per parse, not `z.config`: Better Auth shares this zod instance, and a global map would
 * change its messages. A field's own message (`.min(1, "Enter…")`) wins over this map.
 */
export const errorMap: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "invalid_type" && issue.input === undefined) return "This field is required.";
  return "Check this field.";
};

export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: ValidationFailure } {
  const result = schema.safeParse(raw, { error: errorMap });
  if (result.success) return { ok: true, data: result.data };
  const fields: Record<string, string> = {};
  let message: string | undefined;
  for (const issue of result.error.issues) {
    if (issue.path.length === 0) {
      message ??= issue.message;
      continue;
    }
    fields[issue.path.map(String).join(".")] ??= issue.message;
  }
  return { ok: false, error: { code: "VALIDATION", message: message ?? CHECK_FIELDS, fields } };
}

export type FieldErrors<T = unknown> = Partial<Record<(keyof T & string) | (string & {}), string>>;

export function fieldErrors<S extends z.ZodType>(
  schema: S,
  values: unknown,
): { data: z.output<S>; errors: null } | { data: null; errors: FieldErrors<z.input<S>> } {
  const result = parseInput(schema, values);
  if (result.ok) return { data: result.data, errors: null };
  return { data: null, errors: result.error.fields as FieldErrors<z.input<S>> };
}

/** Moves focus to the first invalid field after React has rendered the errors */
export function focusFirstError(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/** Thrown inside a transaction to roll it back and return this failure to the caller */
export class Rejected {
  constructor(readonly error: ValidationFailure) {}
}

export function rejected(message: string, fields: Record<string, string> = {}): Rejected {
  return new Rejected({ code: "VALIDATION", message, fields });
}
