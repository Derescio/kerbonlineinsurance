import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { properties } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makePolicy, makeUser } from "#/test/factories";

import { DEMO_LINE } from "./PolicyDocument";
import { DOCUMENT_LIMIT, policyDocumentResponse } from "./response";

// The documents route (6.2, decision 7): the owner's PDF, made on request, never cached.

beforeEach(truncateAll);
afterAll(closeDb);

// The factories' policies run 1 Dec 2026 to 30 Nov 2027
const now = new Date("2026-11-20T12:00:00Z");

async function signedInCustomer() {
  const user = await makeUser();
  const customer = await makeCustomer({ userId: user.id });
  const actor = (await resolveActor(getDb(), user.id))!;
  return { customer, actor };
}

async function textOf(response: Response): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

describe("policyDocumentResponse", () => {
  it("gives the owner their certificate, with the reference, dates and demo line", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id });

    const response = await policyDocumentResponse(
      actor,
      { reference: policy.reference, kind: "certificate" },
      now,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="Kerb-${policy.reference}-certificate.pdf"`,
    );
    const text = await textOf(response);
    expect(text).toContain("Certificate of motor insurance");
    expect(text).toContain(policy.reference);
    expect(text).toContain("AB19 CDE");
    expect(text).toContain("1 Dec 2026");
    expect(text).toContain("30 Nov 2027");
    expect(text).toContain(DEMO_LINE);
  }, 30_000);

  it("gives a home policy's schedule, with its address, and no certificate", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id, product: "home" });
    await getDb()
      .update(properties)
      .set({ addressLine1: "11 Rosebery Gardens" })
      .where(eq(properties.quoteItemId, policy.quoteItemId));

    const schedule = await policyDocumentResponse(
      actor,
      { reference: policy.reference, kind: "schedule" },
      now,
    );
    expect(schedule.status).toBe(200);
    const text = await textOf(schedule);
    expect(text).toContain("Policy schedule");
    expect(text).toContain(policy.reference);
    expect(text).toContain("11 Rosebery Gardens");
    expect(text).toContain("1 Dec 2026 to 30 Nov 2027");
    expect(text).toContain(DEMO_LINE);

    const certificate = await policyDocumentResponse(
      actor,
      { reference: policy.reference, kind: "certificate" },
      now,
    );
    expect(certificate.status).toBe(404);
  }, 30_000);

  it.each(["lapsed", "cancelled"] as const)(
    "refuses a %s car's certificate but still gives its schedule",
    async (status) => {
      const { customer, actor } = await signedInCustomer();
      const policy = await makePolicy({
        customerId: customer.id,
        status,
        ...(status === "cancelled" ? { cancelledAt: new Date() } : { lapsedAt: new Date() }),
      });
      const certificate = await policyDocumentResponse(
        actor,
        { reference: policy.reference, kind: "certificate" },
        now,
      );
      expect(certificate.status).toBe(404);
      const schedule = await policyDocumentResponse(
        actor,
        { reference: policy.reference, kind: "schedule" },
        now,
      );
      expect(schedule.status).toBe(200);
    },
    30_000,
  );

  it("refuses an ended car's certificate", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id });
    const response = await policyDocumentResponse(
      actor,
      { reference: policy.reference, kind: "certificate" },
      new Date("2027-12-01T12:00:00Z"),
    );
    expect(response.status).toBe(404);
  });

  it("is 401 with no session, and 404 for another customer's policy or an unknown document", async () => {
    const { actor } = await signedInCustomer();
    const other = await makePolicy();
    const signedOut = await policyDocumentResponse(
      null,
      { reference: other.reference, kind: "schedule" },
      now,
    );
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("Cache-Control")).toBe("private, no-store");
    const notMine = await policyDocumentResponse(
      actor,
      { reference: other.reference, kind: "schedule" },
      now,
    );
    expect(notMine.status).toBe(404);
    const mine = await makePolicy({ customerId: actor.customerId! });
    for (const kind of ["wording", "../schedule", ""]) {
      const unknown = await policyDocumentResponse(actor, { reference: mine.reference, kind }, now);
      expect(unknown.status).toBe(404);
    }
  });

  it("refuses the request over the limit in a minute with 429", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id });
    // An unknown document is refused after the limit has counted it, with no PDF to render
    const statuses: number[] = [];
    for (let i = 0; i <= DOCUMENT_LIMIT.max; i++) {
      statuses.push(
        (await policyDocumentResponse(actor, { reference: policy.reference, kind: "none" }, now))
          .status,
      );
    }
    expect(statuses.slice(0, DOCUMENT_LIMIT.max).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
