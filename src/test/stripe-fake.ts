import Stripe from "stripe";

import type { StripeClient } from "#/server/payments/stripe";

// An in-memory Stripe for integration tests: they never call the real one.
//
// - Every call is recorded in `calls`, keyed by method path ("checkout.sessions.expire"); each
//   entry is that call's argument list, so `calls["refunds.create"][0]` is `[params, options?]`.
// - Creating methods return sequential ids per kind (cs_test_1, cus_test_1, re_test_1, ...) and
//   keep the object, so a later retrieve of that id returns it.
// - `set(method, id, object)` presets what a method returns for an id (retrieve, and also
//   update/cancel/expire/pay/finalize/void, which return the preset merged with the call's params).
//   Presets win over objects the fake created.
// - `fail(method, error, when?)` makes a method throw: every time, or only when `when(...args)` is
//   true (e.g. `(id, params) => "cancel_at" in params`). `failOnce` throws on the first match only.
// - `invoices.list` returns the invoices the fake holds (preset or changed), filtered as Stripe's
//   list is: by `subscription` (the invoice's parent.subscription_details) and `status`.
// - `webhooks` is the real Stripe library's (constructEvent, generateTestHeaderString), so tests
//   sign payloads with the real implementation.
type Obj = Record<string, unknown>;
type Args = unknown[];
type When = (...args: Args) => boolean;

export type StripeMethod =
  | "checkout.sessions.create"
  | "checkout.sessions.retrieve"
  | "checkout.sessions.expire"
  | "customers.create"
  | "customers.retrieve"
  | "subscriptions.retrieve"
  | "subscriptions.update"
  | "subscriptions.cancel"
  | "invoices.retrieve"
  | "invoices.list"
  | "invoices.pay"
  | "invoices.finalizeInvoice"
  | "invoices.voidInvoice"
  | "refunds.create"
  | "paymentIntents.retrieve"
  | "paymentMethods.retrieve"
  | "billingPortal.sessions.create"
  | "testHelpers.testClocks.create";

export interface FakeStripeControls {
  calls: Record<string, Args[]>;
  set(method: StripeMethod, id: string, object: Obj): void;
  fail(method: StripeMethod, error?: Error, when?: When): void;
  failOnce(method: StripeMethod, error?: Error, when?: When): void;
  reset(): void;
}

const PREFIX: Partial<Record<StripeMethod, string>> = {
  "checkout.sessions.create": "cs_test_",
  "customers.create": "cus_test_",
  "refunds.create": "re_test_",
  "billingPortal.sessions.create": "bps_test_",
  "testHelpers.testClocks.create": "clock_test_",
};

// Where a creating method keeps its result, so a later retrieve finds it
const STORE: Partial<Record<StripeMethod, string>> = {
  "checkout.sessions.create": "checkout.sessions",
  "customers.create": "customers",
};

export function fakeStripe(): StripeClient & FakeStripeControls {
  const calls: Record<string, Args[]> = {};
  const presets = new Map<string, Obj>();
  const made = new Map<string, Obj>();
  const counters = new Map<string, number>();
  const failures: { method: StripeMethod; error: Error; when?: When; once: boolean }[] = [];

  const key = (resource: string, id: string) => `${resource}:${id}`;
  const resourceOf = (method: string) => method.slice(0, method.lastIndexOf("."));

  function run(method: StripeMethod, args: Args, handler: () => Obj): Promise<Obj> {
    (calls[method] ??= []).push(args);
    const index = failures.findIndex((f) => f.method === method && (!f.when || f.when(...args)));
    if (index >= 0) {
      const failure = failures[index]!;
      if (failure.once) failures.splice(index, 1);
      return Promise.reject(failure.error);
    }
    try {
      return Promise.resolve(handler());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const missing = (resource: string, id: string) =>
    Object.assign(new Error(`No such ${resource}: '${id}'`), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
    });

  const lookup = (method: StripeMethod, id: string): Obj | undefined => {
    const resource = resourceOf(method);
    return presets.get(key(resource, id)) ?? made.get(key(resource, id));
  };

  const create =
    (method: StripeMethod, extra: (id: string) => Obj = () => ({})) =>
    (params: Obj = {}, ...rest: Args) =>
      run(method, [params, ...rest], () => {
        const prefix = PREFIX[method]!;
        const n = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, n);
        const id = `${prefix}${n}`;
        const object = { id, ...params, ...extra(id) };
        const store = STORE[method];
        if (store) made.set(key(store, id), object);
        return object;
      });

  const retrieve =
    (method: StripeMethod) =>
    (id: string, ...rest: Args) =>
      run(method, [id, ...rest], () => {
        const found = lookup(method, id);
        if (!found) throw missing(resourceOf(method), id);
        return found;
      });

  // update/cancel/expire/pay/...: the stored or preset object (or a bare one) with the changes merged
  const change =
    (method: StripeMethod, changes: (params: Obj) => Obj = (params) => params) =>
    (id: string, params: Obj = {}, ...rest: Args) =>
      run(method, [id, params, ...rest], () => {
        const resource = resourceOf(method);
        const next = { ...(lookup(method, id) ?? { id }), ...changes(params) };
        // Write back to whichever store holds it, so a later retrieve sees the change
        (presets.has(key(resource, id)) ? presets : made).set(key(resource, id), next);
        return next;
      });

  // Stripe's invoice list: every invoice the fake holds, filtered by subscription and status
  const listInvoices = (params: Obj = {}, ...rest: Args) =>
    run("invoices.list", [params, ...rest], () => {
      const held = new Map<string, Obj>();
      for (const store of [made, presets]) {
        for (const [name, object] of store) {
          if (name.startsWith("invoices:")) held.set(name, object);
        }
      }
      const data = [...held.values()].filter((invoice) => {
        const parent = invoice.parent as
          | { subscription_details?: { subscription?: unknown } }
          | undefined;
        if (
          params.subscription &&
          parent?.subscription_details?.subscription !== params.subscription
        )
          return false;
        return !params.status || invoice.status === params.status;
      });
      return { object: "list", data, has_more: false, url: "/v1/invoices" };
    });

  const fake = {
    checkout: {
      sessions: {
        create: create("checkout.sessions.create", (id) => ({
          client_secret: `${id}_secret`,
          status: "open",
          payment_status: "unpaid",
          url: null,
        })),
        retrieve: retrieve("checkout.sessions.retrieve"),
        expire: change("checkout.sessions.expire", () => ({ status: "expired" })),
      },
    },
    customers: {
      create: create("customers.create"),
      retrieve: retrieve("customers.retrieve"),
    },
    subscriptions: {
      retrieve: retrieve("subscriptions.retrieve"),
      update: change("subscriptions.update"),
      cancel: change("subscriptions.cancel", () => ({ status: "canceled" })),
    },
    invoices: {
      retrieve: retrieve("invoices.retrieve"),
      list: listInvoices,
      pay: change("invoices.pay", () => ({ status: "paid" })),
      finalizeInvoice: change("invoices.finalizeInvoice", () => ({ status: "open" })),
      voidInvoice: change("invoices.voidInvoice", () => ({ status: "void" })),
    },
    refunds: { create: create("refunds.create", () => ({ status: "succeeded" })) },
    paymentIntents: { retrieve: retrieve("paymentIntents.retrieve") },
    paymentMethods: { retrieve: retrieve("paymentMethods.retrieve") },
    billingPortal: {
      sessions: {
        create: create("billingPortal.sessions.create", (id) => ({
          url: `https://billing.stripe.test/session/${id}`,
        })),
      },
    },
    testHelpers: { testClocks: { create: create("testHelpers.testClocks.create") } },
    // The real library's, so Task 5's tests sign payloads with the real implementation
    webhooks: Stripe.webhooks,

    calls,
    set(method: StripeMethod, id: string, object: Obj) {
      presets.set(key(resourceOf(method), id), { id, ...object });
    },
    fail(method: StripeMethod, error: Error = new Error("Stripe is down"), when?: When) {
      failures.push({ method, error, when, once: false });
    },
    failOnce(method: StripeMethod, error: Error = new Error("Stripe is down"), when?: When) {
      failures.push({ method, error, when, once: true });
    },
    reset() {
      for (const name of Object.keys(calls)) delete calls[name];
      presets.clear();
      made.clear();
      counters.clear();
      failures.length = 0;
    },
  };
  return fake as unknown as StripeClient & FakeStripeControls;
}
