import { addDays, SeedBuilder } from "./builders.ts";
import { buildCast, buildStaff } from "./cast.ts";
import { buildCrowd } from "./crowd.ts";
import { Rng, SEED, SEED_TO } from "./random.ts";
import { emptyPlan, type SeedContext, type SeedPlan } from "./types.ts";

// Everything the seed writes, generated in memory (4.9): the staff, the cast, then the crowd, from
// one fixed seed. The same context always gives the same plan.
export function generateSeed(ctx: SeedContext): SeedPlan {
  const root = new Rng(SEED);
  const b = new SeedBuilder(ctx, emptyPlan());
  const staff = buildStaff(b, root.fork("staff"));
  buildCast(b, root.fork("cast"), staff);
  buildCrowd(b, root.fork("crowd"), staff);
  renewalReminders(b, root.fork("renewals"));
  return b.plan;
}

/** "Your policy renews soon" for active policies ending within 30 days of the window's end */
function renewalReminders(b: SeedBuilder, rng: Rng) {
  const scrubbed = new Set(b.plan.users.filter((u) => u.scrubbed).map((u) => u.id));
  const userOf = new Map(b.plan.customers.map((c) => [c.id, c.userId]));
  for (const policy of b.plan.policies) {
    if (policy.status !== "active") continue;
    const remindAt = addDays(new Date(`${policy.endsOn}T09:00:00Z`), -30);
    if (remindAt > SEED_TO) continue;
    const userId = userOf.get(policy.customerId)!;
    if (scrubbed.has(userId)) continue;
    b.notify(
      rng,
      userId,
      remindAt,
      "policy.renewal_due",
      "Your policy renews soon",
      `Policy ${policy.reference} renews on ${policy.endsOn}.`,
      "/account",
    );
  }
}
