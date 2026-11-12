import { priceQuote, quoteTotals, type PricedItem } from "#/features/rating/price-quote";
import type { PricedAddon, PricedOption, RatingInputs } from "#/features/rating/types";
import { itemRows, quoteStatus, type ItemDetails } from "#/server/data/quote-rows";
import type { CatalogueRecord } from "#/server/data/reference";
import type { CoverLevel, Product } from "#/server/db/schema/values";
import { POSTCODE_AREAS_V1 } from "#/server/reference/postcode-areas";

import { type Rng, SEED_TO, uuidv7At } from "./random.ts";
import type { SeedContext, SeedPlan, SeedUser } from "./types.ts";

// One customer's records, a step at a time (4.9): sign-up → quote (priced by 5.4's priceQuote(), with
// its options, add-ons, factors, details and first decision) → referral decision → purchase
// (bundle, payments, policies) → claims → review → closure. Every row gets a backdated createdAt;
// the writer fills updatedAt from it where a builder leaves it out. Funnel events and
// notifications are written alongside, as the app will write them.

const DAY = 86_400_000;
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const clampToWindow = (d: Date) => (d > SEED_TO ? SEED_TO : d);

/** Whole years from `dob` to `at` */
export function ageAt(dob: string, at: Date): number {
  const born = new Date(`${dob}T00:00:00Z`);
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const birthday = new Date(Date.UTC(at.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate()));
  if (at < birthday) age--;
  return age;
}

const INWARD_LETTERS = "ABDEFGHJLNPQRSTUWXYZ";

/** `LS6 2AB`: the area, a district 1–9 (call 18), a made-up inward code */
export function makePostcode(rng: Rng, area: string): string {
  return `${area}${rng.int(1, 9)} ${rng.int(1, 9)}${rng.pick(INWARD_LETTERS.split(""))}${rng.pick(INWARD_LETTERS.split(""))}`;
}

export const postcodeArea = (postcode: string) => /^[A-Z]{1,2}/.exec(postcode)![0];

const townOf = (area: string) => POSTCODE_AREAS_V1.find((a) => a.area === area)?.label ?? area;

// --- What a quote item is made from ---

export interface DriverSpec {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  occupation: string;
  licenceYears: number;
  noClaimsYears: number;
  pastClaims: number;
}

export type ItemSpec =
  | {
      product: "car";
      variant: CatalogueRecord;
      driver: DriverSpec;
      namedDriver?: DriverSpec;
      registration: string;
      annualMileage: number;
      usage: string;
      overnightLocation: string;
      voluntaryExcessPence: number;
      coverLevel: CoverLevel;
      addons: string[];
    }
  | {
      product: "home";
      addressLine1: string;
      propertyType: string;
      yearBuilt: number;
      bedrooms: number;
      rebuildCostPence: number;
      contentsValuePence: number;
      hasAlarm: boolean;
      hasSmokeAlarm: boolean;
      lockType: string;
      pastClaims: number;
      coverLevel: CoverLevel;
      addons: string[];
    }
  | {
      product: "business";
      tradeClass: string;
      turnoverPence: number;
      employees: number;
      coverLevel: CoverLevel;
      addons: string[];
    };

// --- Handles the steps pass along ---

export interface CustomerHandle {
  user: SeedUser;
  id: string;
  postcode: string;
}

export interface ItemHandle {
  id: string;
  product: Product;
  priced: PricedItem;
  option: PricedOption & { id: string };
  addons: PricedAddon[];
  startDate: Date;
  voluntaryExcessPence: number;
  row: SeedPlan["quoteItems"][number];
}

export interface QuoteHandle {
  id: string;
  customer: CustomerHandle;
  at: Date;
  items: ItemHandle[];
  row: SeedPlan["quotes"][number];
}

export interface PolicyHandle {
  id: string;
  customer: CustomerHandle;
  product: Product;
  startsOn: Date;
  excessPence: number;
  row: SeedPlan["policies"][number];
}

export interface StaffHandle {
  id: string;
  role: "claims_handler" | "admin";
}

export class SeedBuilder {
  readonly plan: SeedPlan;
  readonly ctx: SeedContext;
  private quoteNumber = 90_000;
  private policyNumber = 900_000;
  private claimNumber = 90_000;

  constructor(ctx: SeedContext, plan: SeedPlan) {
    this.ctx = ctx;
    this.plan = plan;
  }

  user(
    rng: Rng,
    fields: Omit<SeedUser, "id" | "scrubbed" | "staff"> & { staff?: SeedUser["staff"] },
  ): SeedUser {
    const user: SeedUser = {
      id: uuidv7At(fields.createdAt, rng),
      scrubbed: false,
      staff: fields.staff ?? null,
      ...fields,
    };
    this.plan.users.push(user);
    return user;
  }

  customer(
    rng: Rng,
    fields: {
      user: SeedUser;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      postcode: string;
      addressLine1: string;
    },
  ): CustomerHandle {
    const id = uuidv7At(fields.user.createdAt, rng);
    const area = postcodeArea(fields.postcode);
    this.plan.customers.push({
      id,
      userId: fields.user.id,
      firstName: fields.firstName,
      lastName: fields.lastName,
      dateOfBirth: fields.dateOfBirth,
      phone: `07${String(rng.int(100_000_000, 999_999_999))}`,
      addressLine1: fields.addressLine1,
      town: townOf(area),
      postcode: fields.postcode,
      paperless: rng.chance(0.85),
      createdAt: fields.user.createdAt,
    });
    return { user: fields.user, id, postcode: fields.postcode };
  }

  private event(
    name: string,
    at: Date,
    userId: string,
    entity: { type: string; id: string } | null,
    properties: Record<string, string | number> = {},
    rng: Rng,
  ) {
    this.plan.events.push({
      id: uuidv7At(at, rng),
      occurredAt: at,
      name,
      userId,
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      properties,
      createdAt: at,
    });
  }

  notify(
    rng: Rng,
    userId: string,
    at: Date,
    type: string,
    title: string,
    body: string,
    linkPath: string,
  ) {
    this.plan.notifications.push({
      id: uuidv7At(at, rng),
      userId,
      type,
      title,
      body,
      linkPath,
      readAt: at < addDays(SEED_TO, -14) && rng.chance(0.7) ? addDays(at, 1) : null,
      createdAt: at,
    });
  }

  /** A quote with its items priced; null items is a draft abandoned before any price */
  quote(
    rng: Rng,
    customer: CustomerHandle,
    at: Date,
    specs: readonly ItemSpec[] | null,
  ): QuoteHandle {
    const id = uuidv7At(at, rng);
    const row: SeedPlan["quotes"][number] = {
      id,
      reference: `KRB-Q-${this.quoteNumber++}`,
      customerId: customer.id,
      status: "draft",
      postcode: customer.postcode,
      subtotalPence: 0,
      bundleDiscountPence: 0,
      feesPence: 0,
      iptPence: 0,
      totalPence: 0,
      validUntil: addDays(at, 30),
      createdAt: at,
      updatedAt: at,
    };
    this.plan.quotes.push(row);
    const handle: QuoteHandle = { id, customer, at, items: [], row };
    this.event("quote.started", at, customer.user.id, { type: "quote", id }, {}, rng);
    if (!specs) return handle;

    const pricedAt = addMinutes(at, rng.int(3, 15));
    for (const spec of specs) handle.items.push(this.item(rng, handle, spec, pricedAt));
    this.settle(handle, pricedAt);

    this.event(
      "quote.priced",
      pricedAt,
      customer.user.id,
      { type: "quote", id },
      {
        products: specs.map((s) => s.product).join("+"),
      },
      rng,
    );
    for (const item of handle.items) {
      if (item.row.outcome !== "quoted") {
        this.event(
          `quote.${item.row.outcome}`,
          pricedAt,
          customer.user.id,
          {
            type: "quote_item",
            id: item.id,
          },
          { product: item.product, reason: item.row.reasonCode! },
          rng,
        );
      }
    }
    return handle;
  }

  private item(rng: Rng, quote: QuoteHandle, spec: ItemSpec, at: Date): ItemHandle {
    const area = postcodeArea(quote.customer.postcode);
    const version = this.ctx.versions[spec.product];
    // Priced by 5.4's engine, one item at a time: the bundle is a quote total (settle)
    const priced = priceQuote([
      {
        ...this.ratingInputs(spec, area, at),
        tables: { ...version.source, id: version.id },
        coverLevel: spec.coverLevel,
        addons: spec.addons,
      },
    ]).items[0]!;
    const startDate = addDays(at, rng.int(1, 14));
    const voluntaryExcessPence = spec.product === "car" ? spec.voluntaryExcessPence : 0;

    const rows = itemRows(priced, {
      quoteId: quote.id,
      ratingVersionId: version.id,
      at,
      newId: () => uuidv7At(at, rng),
      startDate: isoDate(startDate),
      voluntaryExcessPence,
      details: this.details(rng, spec, quote.customer.id),
    });
    this.plan.quoteItems.push(rows.item);
    this.plan.quoteItemOptions.push(...rows.options);
    this.plan.quoteItemAddons.push(...rows.addons);
    this.plan.quoteItemFactors.push(...rows.factors);
    this.plan.underwritingDecisions.push(rows.decision);
    this.plan.vehicles.push(...rows.vehicles);
    this.plan.drivers.push(...rows.drivers);
    this.plan.properties.push(...rows.properties);
    this.plan.businesses.push(...rows.businesses);

    const option = rows.options.find((o) => o.coverLevel === spec.coverLevel)!;
    return {
      id: rows.item.id,
      product: spec.product,
      priced,
      option: { ...priced.options.find((o) => o.coverLevel === spec.coverLevel)!, id: option.id },
      addons:
        priced.outcome === "declined"
          ? []
          : priced.addons.filter((a) => spec.addons.includes(a.addon)),
      startDate,
      voluntaryExcessPence,
      row: rows.item,
    };
  }

  private ratingInputs(spec: ItemSpec, area: string, at: Date): RatingInputs {
    switch (spec.product) {
      case "car": {
        const named = spec.namedDriver;
        return {
          product: "car",
          inputs: {
            vehicle: {
              year: spec.variant.year,
              insuranceGroup: spec.variant.insuranceGroup,
              fuelType: spec.variant.fuelType,
              valuePence: spec.variant.valuePence,
            },
            driver: {
              age: ageAt(spec.driver.dateOfBirth, at),
              occupation: spec.driver.occupation,
              licenceYears: spec.driver.licenceYears,
              noClaimsYears: spec.driver.noClaimsYears,
            },
            namedDrivers: named
              ? [{ age: ageAt(named.dateOfBirth, at), licenceYears: named.licenceYears }]
              : [],
            // Every driver's claims count (5.4, spec decision 5)
            pastClaims: spec.driver.pastClaims + (named?.pastClaims ?? 0),
            postcodeArea: area,
            annualMileage: spec.annualMileage,
            usage: spec.usage,
            overnightLocation: spec.overnightLocation,
            voluntaryExcessPence: spec.voluntaryExcessPence,
          },
        };
      }
      case "home":
        return {
          product: "home",
          inputs: {
            postcodeArea: area,
            propertyType: spec.propertyType,
            yearBuilt: spec.yearBuilt,
            bedrooms: spec.bedrooms,
            rebuildCostPence: spec.rebuildCostPence,
            contentsValuePence: spec.contentsValuePence,
            hasAlarm: spec.hasAlarm,
            hasSmokeAlarm: spec.hasSmokeAlarm,
            lockType: spec.lockType,
            pastClaims: spec.pastClaims,
          },
        };
      case "business":
        return {
          product: "business",
          inputs: {
            tradeClass: spec.tradeClass,
            postcodeArea: area,
            turnoverPence: spec.turnoverPence,
            employees: spec.employees,
          },
        };
    }
  }

  private details(rng: Rng, spec: ItemSpec, customerId: string): ItemDetails {
    switch (spec.product) {
      case "car": {
        const v = spec.variant;
        return {
          product: "car",
          vehicle: {
            make: v.make,
            model: v.model,
            year: v.year,
            variant: v.variant,
            fuelType: v.fuelType,
            doors: v.doors,
            insuranceGroup: v.insuranceGroup,
            valuePence: v.valuePence,
            catalogueVariantId: v.id,
            registration: spec.registration,
            currentMileage: Math.max(0, (2026 - v.year) * spec.annualMileage + rng.int(0, 3_000)),
            annualMileage: spec.annualMileage,
            usage: spec.usage,
            overnightLocation: spec.overnightLocation,
          },
          drivers: [spec.driver, ...(spec.namedDriver ? [spec.namedDriver] : [])].map((d) => ({
            firstName: d.firstName,
            lastName: d.lastName,
            dateOfBirth: d.dateOfBirth,
            occupation: d.occupation,
            licenceYears: d.licenceYears,
            noClaimsYears: d.noClaimsYears,
            pastClaims: d.pastClaims,
          })),
        };
      }
      case "home": {
        const customer = this.plan.customers.find((c) => c.id === customerId)!;
        return {
          product: "home",
          property: {
            addressLine1: spec.addressLine1,
            town: customer.town,
            postcode: customer.postcode,
            propertyType: spec.propertyType,
            yearBuilt: spec.yearBuilt,
            bedrooms: spec.bedrooms,
            rebuildCostPence: spec.rebuildCostPence,
            contentsValuePence: spec.contentsValuePence,
            hasAlarm: spec.hasAlarm,
            hasSmokeAlarm: spec.hasSmokeAlarm,
            lockType: spec.lockType,
            pastClaims: spec.pastClaims,
          },
        };
      }
      case "business":
        return {
          product: "business",
          business: {
            tradeClass: spec.tradeClass,
            turnoverPence: spec.turnoverPence,
            employees: spec.employees,
            coverSections: spec.addons,
          },
        };
    }
  }

  /** Status and totals from the quoted items, by 5.4's rules (the 4.2 CHECKs reconcile them) */
  private settle(quote: QuoteHandle, at: Date) {
    const totals = quoteTotals(
      quote.items
        .filter((i) => i.row.outcome === "quoted")
        .map((i) => {
          const p = this.ctx.versions[i.product].source.parameters;
          return {
            product: i.product,
            premiumPence: i.option.annualPremiumPence,
            addonsPence: i.addons.reduce((sum, a) => sum + a.annualPricePence, 0),
            iptRate: p.ipt_rate!,
            feePence: p.fee_pence!,
            bundleRate: p.bundle_discount_rate!,
          };
        }),
    );
    Object.assign(quote.row, {
      subtotalPence: totals.subtotalPence,
      bundleDiscountPence: totals.bundleDiscountPence,
      feesPence: totals.feesPence,
      iptPence: totals.iptPence,
      totalPence: totals.totalPence,
      status: quoteStatus(quote.items.map((i) => i.row.outcome as PricedItem["outcome"])),
      updatedAt: at,
    });
  }

  /** A person decides each referred item on the quote (6.11): quoted or declined */
  decideReferrals(
    rng: Rng,
    quote: QuoteHandle,
    staff: StaffHandle,
    at: Date,
    outcome: "quoted" | "declined",
  ) {
    for (const item of quote.items.filter((i) => i.row.outcome === "referred")) {
      this.plan.underwritingDecisions.push({
        quoteItemId: item.id,
        outcome,
        reasonCode: outcome === "quoted" ? null : item.row.reasonCode,
        loadingPercent: outcome === "quoted" ? 0 : null,
        decidedBy: staff.id,
        note: outcome === "quoted" ? "Checked and accepted." : "Outside what we can cover.",
        createdAt: at,
      });
      Object.assign(item.row, {
        outcome,
        reasonCode: outcome === "quoted" ? null : item.row.reasonCode,
        selectedOptionId: outcome === "declined" ? null : item.option.id,
        updatedAt: at,
      });
      if (outcome === "declined") {
        item.addons = [];
        for (const a of this.plan.quoteItemAddons) {
          if (a.quoteItemId === item.id) Object.assign(a, { selected: false, updatedAt: at });
        }
      }
      this.plan.audit.push({
        action: "referral.viewed",
        entityId: item.id,
        actorUserId: staff.id,
        actorRole: staff.role,
      });
    }
    this.settle(quote, at);
    this.notify(
      rng,
      quote.customer.user.id,
      at,
      "referral.decided",
      "Your quote has been reviewed",
      outcome === "quoted"
        ? "Good news: we can offer you cover."
        : "Sorry, we can't offer cover this time.",
      "/account",
    );
  }

  /** Buying: every item must be quoted. Returns one policy per item */
  accept(rng: Rng, quote: QuoteHandle, at: Date, plan: "annual" | "monthly"): PolicyHandle[] {
    if (quote.items.some((i) => i.row.outcome !== "quoted")) {
      throw new Error(`${quote.row.reference}: only a fully quoted quote can be bought`);
    }
    Object.assign(quote.row, {
      status: "accepted",
      paymentPlan: plan,
      detailsConfirmedAt: at,
      coverAcknowledgedAt: at,
      updatedAt: at,
    });

    let bundleId: string | null = null;
    if (quote.items.length >= 2) {
      bundleId = uuidv7At(at, rng);
      this.plan.bundles.push({
        id: bundleId,
        customerId: quote.customer.id,
        quoteId: quote.id,
        createdAt: at,
      });
    }

    this.payments(rng, quote, at, plan);

    return quote.items.map((item) => {
      // Bought after the start date the quote offered: cover starts the next day
      if (item.startDate < at) {
        item.startDate = addDays(at, 1);
        Object.assign(item.row, { startDate: isoDate(item.startDate), updatedAt: at });
      }
      const id = uuidv7At(at, rng);
      const excessPence = item.option.compulsoryExcessPence + item.voluntaryExcessPence;
      const row: SeedPlan["policies"][number] = {
        id,
        reference: `KRB-${this.policyNumber++}`,
        customerId: quote.customer.id,
        quoteId: quote.id,
        quoteItemId: item.id,
        bundleId,
        product: item.product,
        coverLevel: item.option.coverLevel,
        status: "active",
        startsOn: isoDate(item.startDate),
        endsOn: isoDate(addDays(item.startDate, 365)),
        annualPremiumPence:
          item.option.annualPremiumPence + item.addons.reduce((s, a) => s + a.annualPricePence, 0),
        compulsoryExcessPence: item.option.compulsoryExcessPence,
        voluntaryExcessPence: item.voluntaryExcessPence,
        autoRenew: rng.chance(0.8),
        termsAcceptedAt: at,
        createdAt: at,
        updatedAt: at,
      };
      this.plan.policies.push(row);
      this.event(
        "policy.bought",
        at,
        quote.customer.user.id,
        { type: "policy", id },
        {
          product: item.product,
          plan,
        },
        rng,
      );
      return {
        id,
        customer: quote.customer,
        product: item.product,
        startsOn: item.startDate,
        excessPence,
        row,
      };
    });
  }

  private payments(rng: Rng, quote: QuoteHandle, at: Date, plan: "annual" | "monthly") {
    const card = {
      cardBrand: rng.weighted([
        ["Visa", 6],
        ["Mastercard", 3],
        ["Amex", 1],
      ] as const),
      cardLast4: String(rng.int(0, 9_999)).padStart(4, "0"),
    };
    const total = quote.row.totalPence!;
    const base = { customerId: quote.customer.id, quoteId: quote.id, plan, createdAt: at, ...card };
    if (plan === "annual") {
      this.plan.payments.push({
        ...base,
        id: uuidv7At(at, rng),
        instalmentNumber: 1,
        amountPence: total,
        status: "succeeded",
        dueOn: isoDate(at),
        paidAt: at,
      });
      return;
    }
    const credit =
      this.ctx.versions[quote.items[0]!.product].source.parameters.monthly_credit_charge_rate!;
    const instalment = Math.round((total * (1 + credit)) / 12);
    for (let n = 1; n <= 12; n++) {
      const due = addDays(at, (n - 1) * 30);
      const past = due <= SEED_TO;
      const failed = past && n > 1 && rng.chance(0.03);
      this.plan.payments.push({
        ...base,
        id: uuidv7At(at, rng),
        instalmentNumber: n,
        amountPence: instalment,
        status: !past ? "scheduled" : failed ? "failed" : "succeeded",
        dueOn: isoDate(due),
        paidAt: past && !failed ? due : null,
        updatedAt: past ? due : at,
      });
      if (failed) {
        this.notify(
          rng,
          quote.customer.user.id,
          due,
          "payment.failed",
          "A payment didn't go through",
          "We couldn't take your monthly payment. Please check your card details.",
          "/account",
        );
      }
    }
  }

  cancelPolicy(policy: PolicyHandle, at: Date) {
    Object.assign(policy.row, { status: "cancelled", cancelledAt: at, version: 2, updatedAt: at });
  }

  /** A claim taken to `status`, with the timeline, messages and settlement that status implies */
  claim(
    rng: Rng,
    policy: PolicyHandle,
    status: "draft" | "received" | "assessing" | "approved" | "declined" | "settled",
    at: Date,
    handler: StaffHandle,
    opts: { incidentType?: string; claimedAmountPence?: number; description?: string } = {},
  ) {
    const id = uuidv7At(at, rng);
    const customerUserId = policy.customer.user.id;
    const incidentType =
      opts.incidentType ??
      (policy.product === "car"
        ? rng.weighted([
            ["collision", 5],
            ["glass", 2],
            ["theft", 1],
            ["other", 1],
          ] as const)
        : rng.weighted([
            ["other", 3],
            ["theft", 1],
          ] as const));
    const row: SeedPlan["claims"][number] = {
      id,
      reference: `KRB-C-${this.claimNumber++}`,
      policyId: policy.id,
      customerId: policy.customer.id,
      status,
      incidentType,
      createdAt: at,
      updatedAt: at,
    };
    this.plan.claims.push(row);
    if (status === "draft") return row;

    const other = incidentType === "collision" && rng.chance(0.6);
    const claimed = opts.claimedAmountPence ?? CLAIM_AMOUNTS[incidentType]!(rng);
    Object.assign(row, {
      // Never before cover started
      incidentAt: new Date(
        Math.max(addDays(at, -rng.int(1, 5)).getTime(), policy.startsOn.getTime()),
      ),
      incidentLocation: `${rng.pick(LOCATIONS)}, ${policy.customer.postcode.split(" ")[0]}`,
      description: opts.description ?? rng.pick(DESCRIPTIONS[incidentType]!),
      declarationAcceptedAt: at,
      submittedAt: at,
      otherVehicleInvolved: other,
      rearEnded: other && rng.chance(0.4),
      claimedAmountPence: claimed,
    });
    this.event(
      "claim.opened",
      at,
      customerUserId,
      { type: "claim", id },
      { product: policy.product },
      rng,
    );
    if (other) {
      this.plan.claimThirdParties.push({
        id: uuidv7At(at, rng),
        claimId: id,
        name: "Other driver",
        registration: registration(rng, 2019),
        insurerName: rng.pick(["Direct Motor", "Northway Insurance", "Harbour Mutual"]),
        createdAt: at,
      });
    }

    const timeline: {
      type: string;
      from?: string;
      to?: string;
      visibility: string;
      note?: string;
      actor: string;
      at: Date;
    }[] = [
      { type: "submitted", to: "received", visibility: "customer", actor: customerUserId, at },
    ];
    let t = at;
    const step = (days: number) => (t = addDays(t, days));
    const path: string[] =
      status === "received"
        ? []
        : status === "assessing"
          ? ["assessing"]
          : status === "approved"
            ? ["assessing", "approved"]
            : status === "declined"
              ? ["assessing", "declined"]
              : ["assessing", "approved", "settled"];

    let from = "received";
    let version = 1;
    for (const to of path) {
      step(to === "assessing" ? 2 : to === "settled" ? 8 : 7);
      if (to === "assessing") {
        timeline.push({
          type: "status_changed",
          from,
          to,
          visibility: "customer",
          actor: handler.id,
          at: t,
        });
        timeline.push({
          type: "details_checked",
          visibility: "internal",
          note: "Policy and cover checked.",
          actor: handler.id,
          at: addMinutes(t, 30),
        });
        this.messages(rng, id, customerUserId, handler.id, t);
      } else {
        timeline.push({
          type: "status_changed",
          from,
          to,
          visibility: "customer",
          actor: handler.id,
          at: t,
        });
      }
      if (to === "approved") {
        timeline.push({
          type: "settlement_scheduled",
          visibility: "customer",
          actor: handler.id,
          at: addMinutes(t, 5),
        });
      }
      if (to === "settled") {
        timeline.push({
          type: "settlement_paid",
          visibility: "customer",
          actor: handler.id,
          at: addMinutes(t, 5),
        });
      }
      this.notify(
        rng,
        customerUserId,
        t,
        "claim.updated",
        "Your claim has an update",
        `Your claim is now ${to}.`,
        `/claims/${id}`,
      );
      from = to;
      version++;
    }
    for (const e of timeline) {
      this.plan.claimEvents.push({
        claimId: id,
        type: e.type,
        visibility: e.visibility,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        note: e.note ?? null,
        actorUserId: e.actor,
        createdAt: e.at,
      });
    }
    if (path.length > 0) {
      row.assignedHandlerId = handler.id;
      this.plan.audit.push({
        action: "claim.viewed",
        entityId: id,
        actorUserId: handler.id,
        actorRole: handler.role,
      });
    }
    if (status === "approved" || status === "settled") {
      const approved = Math.round(claimed * (0.6 + rng.next() * 0.4));
      const approvedAt = timeline.find((e) => e.to === "approved")!.at;
      const paidAt = status === "settled" ? t : null;
      this.plan.claimSettlements.push({
        id: uuidv7At(approvedAt, rng),
        claimId: id,
        approvedAmountPence: approved,
        excessPence: policy.excessPence,
        payoutPence: Math.max(approved - policy.excessPence, 0),
        payeeName: payee(this.plan, policy.customer.id),
        accountLast4: String(rng.int(0, 9_999)).padStart(4, "0"),
        status: paidAt ? "paid" : "scheduled",
        expectedOn: isoDate(addDays(approvedAt, 8)),
        paidAt,
        approvedBy: handler.id,
        createdAt: approvedAt,
        updatedAt: paidAt ?? approvedAt,
      });
    }
    Object.assign(row, { version, updatedAt: t });
    return row;
  }

  private messages(rng: Rng, claimId: string, customerUserId: string, handlerId: string, at: Date) {
    const staffAt = clampToWindow(addMinutes(at, 45));
    const replyAt = clampToWindow(addMinutes(at, rng.int(120, 1_440)));
    this.plan.claimMessages.push(
      {
        id: uuidv7At(staffAt, rng),
        claimId,
        senderUserId: handlerId,
        senderKind: "staff",
        body: "Thanks for your claim. I'm looking at it now and will be in touch if I need anything else.",
        readAt: replyAt,
        createdAt: staffAt,
      },
      {
        id: uuidv7At(replyAt, rng),
        claimId,
        senderUserId: customerUserId,
        senderKind: "customer",
        body: rng.pick(["Thank you.", "Great, thanks for the update.", "Do you need any photos?"]),
        createdAt: replyAt,
      },
    );
  }

  review(
    rng: Rng,
    policy: PolicyHandle,
    at: Date,
    text: { rating: number; title: string; body: string },
    status: "published" | "pending" | "rejected",
  ) {
    this.plan.reviews.push({
      id: uuidv7At(at, rng),
      policyId: policy.id,
      customerId: policy.customer.id,
      rating: text.rating,
      title: text.title,
      body: text.body,
      status,
      moderationReason: status === "rejected" ? "Contains personal details" : null,
      publishedAt: status === "published" ? addDays(at, 1) : null,
      createdAt: at,
      updatedAt: status === "pending" ? at : addDays(at, 1),
    });
  }

  /** A 4.7 closure request: kept (cancelled) or closed, which scrubs the user as 4.7 does */
  closure(rng: Rng, customer: CustomerHandle, requestedAt: Date, ending: "cancelled" | "closed") {
    const closesAt = addDays(requestedAt, 30);
    const userId = customer.user.id;
    const endedAt = ending === "closed" ? closesAt : addDays(requestedAt, rng.int(1, 20));
    this.plan.accountClosures.push({
      id: uuidv7At(requestedAt, rng),
      userId,
      requestedAt,
      closesAt,
      cancelledAt: ending === "cancelled" ? endedAt : null,
      closedAt: ending === "closed" ? endedAt : null,
      retainUntil: ending === "closed" ? addDays(endedAt, 365 * 7 + 2) : null,
      createdAt: requestedAt,
      updatedAt: endedAt,
    });
    this.plan.audit.push({
      action: "account.closure_requested",
      entityId: userId,
      actorUserId: userId,
      actorRole: "customer",
    });
    if (ending === "cancelled") {
      this.plan.audit.push({
        action: "account.closure_cancelled",
        entityId: userId,
        actorUserId: userId,
        actorRole: "customer",
      });
      return;
    }
    this.plan.audit.push({
      action: "account.closed",
      entityId: userId,
      actorUserId: null,
      actorRole: null,
    });
    Object.assign(customer.user, {
      email: `closed+${userId}@closed.invalid`,
      name: "Closed account",
      scrubbed: true,
    });
  }
}

// --- Small generated values ---

const REG_LETTERS = "ABCDEFGHJKLMNOPRSTUVWXY";

/** A UK-format plate for the car's year: two letters, the age identifier, three letters */
export function registration(rng: Rng, year: number): string {
  const half = rng.chance(0.5) ? 0 : 50;
  const age = String((year % 100) + half).padStart(2, "0");
  const letters = (n: number) =>
    Array.from({ length: n }, () => rng.pick(REG_LETTERS.split(""))).join("");
  return `${letters(2)}${age} ${letters(3)}`;
}

const LOCATIONS = [
  "High Street",
  "Ring Road",
  "Supermarket car park",
  "Home",
  "Station Road",
  "Retail park",
];

const CLAIM_AMOUNTS: Record<string, (rng: Rng) => number> = {
  collision: (rng) => rng.int(80_000, 650_000),
  glass: (rng) => rng.int(9_000, 45_000),
  theft: (rng) => rng.int(50_000, 1_200_000),
  other: (rng) => rng.int(30_000, 400_000),
};

const DESCRIPTIONS: Record<string, string[]> = {
  collision: [
    "Another car pulled out of a side road and hit my front wing.",
    "I was stationary at lights when the car behind ran into me.",
    "Reversed into a bollard in a car park; rear bumper damaged.",
  ],
  glass: ["A stone chipped the windscreen on the motorway and the crack has spread."],
  theft: [
    "Items taken overnight; reported to the police.",
    "Break-in while we were away; a window was forced.",
  ],
  other: [
    "Water leak from the bathroom upstairs damaged the kitchen ceiling.",
    "Storm damage to the fence and some roof tiles.",
    "Accidental damage to equipment during a job.",
  ],
};

function payee(plan: SeedPlan, customerId: string): string {
  const c = plan.customers.find((x) => x.id === customerId)!;
  return `${c.firstName} ${c.lastName}`;
}
