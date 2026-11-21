// Copy for the one-item saving (6.1b, decisions 1, 4 and 5). The percent is the version's rate.

export function savingSentence(other: "car" | "home", rate: number): string {
  const held = other === "car" ? "car" : "home";
  return `You save ${Math.round(rate * 100)}% because you already insure your ${held} with us.`;
}

export function savingRemovedSentence(other: "car" | "home"): string {
  const held = other === "car" ? "car" : "home";
  return `Your ${held} policy is no longer active, so this price doesn’t include the saving.`;
}
