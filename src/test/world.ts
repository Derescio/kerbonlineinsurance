import { resolveActor } from "#/server/auth/actor";
import { getDb } from "#/server/db/client";
import { claimEvents } from "#/server/db/schema";

import { makeClaim, makeCustomer, makePolicy, makeReferral, makeStaff } from "./factories";

// The people and records the permission suite attacks every read with (4.5). Integration tests only:
// it writes through getDb(). Call it after truncateAll().

export async function buildWorld() {
  const db = getDb();
  const actorFor = (userId: string) =>
    resolveActor(db, userId, { twoFactorVerifiedAt: new Date() });

  const customerA = await makeCustomer();
  const customerB = await makeCustomer();
  const handler = await makeStaff({ roles: ["claims_handler"] });
  const admin = await makeStaff({ roles: ["admin"] });
  // Deactivated: startedAt is set earlier because deactivated_at must be after started_at
  const deactivated = await makeStaff({
    roles: ["claims_handler"],
    startedAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: new Date("2026-02-01T00:00:00Z"),
  });
  // An admin who is also a customer, to test the conflict-of-interest rule
  const adminCustomer = await makeCustomer();
  await makeStaff({ roles: ["admin"], userId: adminCustomer.userId });
  const roleless = await makeStaff({ roles: [] });
  const handlerNoCustomer = await makeStaff({ roles: ["claims_handler"] });

  const policyA = await makePolicy({ customerId: customerA.id });
  const claimA = await makeClaim({ customerId: customerA.id, policyId: policyA.id });
  const draftClaimA = await makeClaim({
    status: "draft",
    customerId: customerA.id,
    policyId: policyA.id,
  });
  await db.insert(claimEvents).values([
    { claimId: claimA.id, type: "submitted", visibility: "customer" },
    { claimId: claimA.id, type: "note", visibility: "internal", note: "Staff only" },
  ]);
  const referralA = await makeReferral({ customerId: customerA.id });

  const policyB = await makePolicy({ customerId: customerB.id });
  const claimB = await makeClaim({ customerId: customerB.id, policyId: policyB.id });

  const adminClaim = await makeClaim({ customerId: adminCustomer.id });
  const adminReferral = await makeReferral({ customerId: adminCustomer.id });

  return {
    guest: null,
    customerA: await actorFor(customerA.userId),
    customerB: await actorFor(customerB.userId),
    handler: await actorFor(handler.userId),
    admin: await actorFor(admin.userId),
    deactivatedHandler: await actorFor(deactivated.userId),
    adminCustomer: await actorFor(adminCustomer.userId),
    rolelessStaff: await actorFor(roleless.userId),
    handlerNoCustomer: await actorFor(handlerNoCustomer.userId),
    records: {
      policyA,
      claimA,
      draftClaimA,
      referralA,
      policyB,
      claimB,
      adminClaim,
      adminReferral,
    },
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
