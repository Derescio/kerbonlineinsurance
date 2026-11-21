import { eq } from "drizzle-orm";
import { z } from "zod";

import { todayIso } from "#/features/quote/schemas/dates";
import { Tables } from "#/features/rating/tables";
import { customers } from "#/server/db/schema";

import { defineRead } from "./define";
import { earningPolicy, type Buyable } from "./multi-policy-rows";
import { getActiveRatingTables } from "./reference";

// The signed-in reads behind adding the other product (6.1b): Choose cover's saving and the
// Overview's cards.

export interface AccountCustomer {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
}

const offerInput = z.object({ product: z.enum(["car", "home"]) });

/** The other product a signed-in customer already holds, or null (6.1b, decision 4). */
export const getMultiPolicyOffer = defineRead(
  "signed_in",
  offerInput,
  async (actor, input, db): Promise<{ otherProduct: Buyable } | null> => {
    if (!actor.customerId) return null;
    const earning = await earningPolicy(db, actor.customerId, input.product, todayIso());
    return earning ? { otherProduct: earning.product } : null;
  },
);

/** The customer record and the two products' bundle rates, for the Overview's cards (6.1b). */
export const getMyAddProducts = defineRead(
  "signed_in",
  z.object({}),
  async (
    actor,
    _input,
    db,
  ): Promise<{ customer: AccountCustomer | null; rates: { car: number; home: number } }> => {
    const [car, home] = await Promise.all([
      getActiveRatingTables("car", db),
      getActiveRatingTables("home", db),
    ]);
    const rates = {
      car: new Tables(car).param("bundle_discount_rate"),
      home: new Tables(home).param("bundle_discount_rate"),
    };
    if (!actor.customerId) return { customer: null, rates };
    const customer = await db.query.customers.findFirst({
      columns: {
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        addressLine1: true,
        addressLine2: true,
        town: true,
        postcode: true,
      },
      where: eq(customers.id, actor.customerId),
    });
    return { customer: customer ?? null, rates };
  },
);
