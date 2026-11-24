import { eq } from "drizzle-orm";
import { vi } from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { instalmentDates } from "#/features/quote/policy-terms";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { getDb } from "#/server/db/client";
import { policies } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { purchase } from "#/server/quote/purchase";
import { saveCarQuoteFor } from "#/server/quote/save";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import type { RatingSource } from "#/server/reference/rating/types";

import { SECRET } from "./auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "./db";
import { makeUser } from "./factories";

// A car policy bought the real way (6.3b): the frames' journey saved and priced on car v1, then
// purchase(), so its rows, money and version 1 are what a customer's would be. Cover runs from
// 20 Nov 2026 to 19 Nov 2027.

export const BOUGHT_AT = new Date("2026-11-11T12:00:00Z");
export const STARTS_ON = "2026-11-20";

/** Env the purchase email reads, and the reference data; call from beforeAll */
export async function setUpPolicyWorld(extraRating: readonly RatingSource[] = []): Promise<void> {
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kerb <hello@example.com>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone([...RATING_SOURCES, ...extraRating]),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
}

/** Everything but the reference data; call from beforeEach */
export async function resetPolicyWorld(): Promise<void> {
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
}

/** The frames' journey with the catalogue's 2021 Golf */
export async function golfJourney(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

export async function boughtCarPolicy({
  plan = "annual",
  journey,
}: { plan?: "annual" | "monthly"; journey?: Journey } = {}): Promise<{
  actor: Actor;
  policy: typeof policies.$inferSelect;
}> {
  const user = await makeUser();
  const answers = journey ?? (await golfJourney());
  const saved = await withTx(getDb(), (tx) =>
    saveCarQuoteFor(tx, user.id, { journey: answers, now: BOUGHT_AT }),
  );
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  const monthly = plan === "monthly";
  const result = await withTx(getDb(), (tx) =>
    purchase(tx, {
      userId: actor.userId,
      customerId: actor.customerId!,
      quoteId: saved.quoteId,
      plan,
      startsOn: STARTS_ON,
      detailsConfirmedAt: BOUGHT_AT,
      coverAcknowledgedAt: BOUGHT_AT,
      card: { brand: "Visa", last4: "4242" },
      stripe: monthly
        ? {
            subscriptionId: `sub_${saved.quoteId}`,
            invoiceId: `in_${saved.quoteId}`,
            paymentIntentId: `pi_${saved.quoteId}`,
            instalmentDates: instalmentDates("2026-11-11", 12),
          }
        : { paymentIntentId: `pi_${saved.quoteId}` },
      auditActor: actor,
      now: BOUGHT_AT,
    }),
  );
  if (result.status !== "bought") throw new Error(`not bought: ${result.status}`);
  const [policy] = await getDb().select().from(policies).where(eq(policies.quoteId, saved.quoteId));
  return { actor, policy: policy! };
}
