export type KerbEnv = "production" | "preview" | "staging" | "local";

// Which Kerb environment this is, tagged on every Stripe object (`metadata.kerb_env`) because one
// sandbox serves them all. VERCEL_TARGET_ENV is "production", "preview" or a custom environment's
// name ("staging"); VERCEL_ENV says "preview" for custom environments too, so it can't tell
// Staging from a PR preview. Unset (or anything else, like "development") is local.
export function kerbEnv(source: Record<string, string | undefined> = process.env): KerbEnv {
  const target = source.VERCEL_TARGET_ENV?.trim();
  if (target === "production" || target === "preview" || target === "staging") return target;
  return "local";
}
