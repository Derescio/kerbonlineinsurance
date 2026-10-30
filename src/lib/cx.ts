/** Joins class names, skipping falsy values: `cx("kb-btn", loading && "is-busy")`. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
