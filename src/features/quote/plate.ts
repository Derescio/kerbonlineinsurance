// The registration box (5.2, screen 08). The lookup only matches demo plates (call 6), so this
// just makes two spellings of one plate compare equal: case, spaces and dashes don't count.

export const plateError = "Enter your registration.";

/** "vw21-gql " → "VW21GQL" */
export function normalisePlate(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}
