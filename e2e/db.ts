import { expect } from "@playwright/test";
import pg from "pg";

// The E2E run's own database access (4.7, 5.6). The run can't open the confirmation email (Resend's
// test inbox), so a spec that signs up confirms the address straight in the database. Set
// E2E_DATABASE_URL to the same database as the deploy under test: the Neon `dev` branch's
// credentials, never prod. Without it, those tests skip with the reason.
export const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

// Only ever touches an address a spec just made, so a mis-set E2E_DATABASE_URL can't confirm
// anyone else
const OWN_EMAIL = /^delivered\+e2e-(close|buy)-\d+@resend\.dev$/;

export async function confirmEmailInDatabase(email: string): Promise<void> {
  if (!OWN_EMAIL.test(email)) {
    throw new Error(`Refusing to confirm ${email}: not an address a spec created`);
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query("update users set email_verified = true where email = $1", [
      email,
    ]);
    expect(
      result.rowCount,
      "E2E_DATABASE_URL must point at the same database as the deploy under test",
    ).toBe(1);
  } finally {
    await client.end();
  }
}
