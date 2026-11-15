# 5.6b Stripe payments: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5.6's demo card is replaced by Stripe in test mode:
- paying in full is a single payment, and paying monthly is a 12-period subscription, both through embedded Checkout;
- a webhook keeps Kerb's payments and policies in step: each paid month, a failed payment, lapse, resume, voiding and the 30-day cancellation.

**Architecture:**
- **One Stripe wrapper** (`src/server/payments/stripe.ts`). It's injectable, so tests use a fake.
- **`startCheckout`** records a `checkout_sessions` row and returns the session's client secret.
- **`fulfilCheckout(sessionId)`** reruns 5.6's purchase transaction, which moves into `src/server/quote/purchase.ts`. Both the webhook and the return page call it.
- **The webhook route** checks the signature, records each event in `stripe_events` so none is handled twice, filters by `kerb_env`, and dispatches to one handler per event type.

**Tech Stack:** TanStack Start (server routes, server functions), Drizzle on Postgres, `stripe` (Node), `@stripe/stripe-js` and `@stripe/react-stripe-js` (EmbeddedCheckout), Vitest, Playwright.

**Spec:** [06b-stripe-payments.md](06b-stripe-payments.md). Read all 15 decisions and "Damion's setup" first.

## Global Constraints

- **Test keys only:**
  - `getStripe()` throws `Stripe secret key must be a test key (sk_test_…).` when `STRIPE_SECRET_KEY` doesn't start with `sk_test_`.
  - The publishable key is read from `import.meta.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- **The API version is pinned** to the installed `stripe` package's latest version, written as a literal in `stripe.ts` and in the spec's "Notes from the build". The code reads invoices and subscriptions in that version's shape: an invoice's subscription is under `parent.subscription_details`, and a subscription's period end is on its item.
- **`kerb_env`:** `kerbEnv()` returns `VERCEL_TARGET_ENV` when set (`production`, `preview`, `staging`), otherwise `"local"`. It goes on the metadata of every Session, its `subscription_data` and `payment_intent_data`, and every Customer. Webhook objects with another value are ignored with `200`.
- **Cards only:** `payment_method_types: ["card"]`.
- **Sessions** use `ui_mode: "embedded"`, `expires_at` = now + 30 min, and `return_url` = `${baseURL}/quote/covered/${quoteId}?session_id={CHECKOUT_SESSION_ID}`.
- **Amounts:**
  - In full = `quotes.total_pence`, in `payment` mode.
  - Monthly = `monthlyPaymentFor()` (5.6), in `subscription` mode with `recurring: { interval: "month" }`.
  - Currency `gbp`, with the line name `Kerb car insurance, {Tier}, {registration or make model}`.
- **Never store or log** card data or Stripe event bodies. The `card_brand`/`card_last4` come from Stripe's payment method, title-cased as 5.6 shows them (`Visa`).
- **The audit actions are new, with actor `null` for the system:**
  - `policy.lapsed`, `policy.resumed` and `policy.cancelled_unpaid` (entity `policy`);
  - `payment.refunded` (entity `checkout_session`).
- **The emails are new templates:**
  - `payment_failed`: "We couldn’t take this month’s payment";
  - `cover_lapsed`: "You’re no longer covered";
  - `cover_resumed`: "Your cover has resumed";
  - `policy_cancelled_unpaid`: "Your policy has been cancelled";
  - `payment_refunded`: "We’ve refunded your payment".

  Each links to `${baseURL}/account/billing`, except `payment_refunded`, which links to `/account`. Follow `templates.ts`'s style.
- **Copy, exactly:**
  - **Confirm and pay:** the button `Continue to payment`; the test-card line `Test cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined, 4000 0025 0000 3155 asks for 3-D Secure, 4000 0000 0000 0341 fails on a later month.`
  - **You're covered:** `Confirming your payment…`, then `Your payment is being confirmed. We’ll email you when your policy is ready.`
  - **`/account`:** `Update your payment card`; for a customer with no monthly plan, `You don’t pay monthly, so there’s no card to update.`
- **Conventions:**
  - The Vitest projects are `unit`, `integration` and `component`.
  - Check port 3000 before component tests or a build.
  - Stage files by name.
  - Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`.
  - Integration tests never call real Stripe: use the fake from Task 1.

## Review Focus

1. **The same event delivered twice, concurrently.** The `stripe_events` insert is the gate (`ON CONFLICT DO NOTHING` inside the handler's transaction), so two deliveries can't both act. Test in Task 5.
2. **The return page and the webhook fulfilling at the same moment.** The `checkout_sessions` row is locked `FOR UPDATE` before fulfilling, so one policy results. Test in Task 4.
3. **A customer who presses "Continue to payment" twice.** The second call expires the first session (decision 5), and the first form, if still mounted, can't complete. Test in Task 3.
4. **`invoice.paid` for month 2 arriving before `checkout.session.completed`.** It finds no instalment rows yet: it returns `500` so Stripe retries, rather than dropping the payment. Test in Task 5.
5. **Updating the card while `past_due` (still covered).** Nothing is force-paid, because Stripe's own retries handle it. Kerb pays only `unpaid` subscriptions. Test in Task 6.

---

### Task 1: The Stripe wrapper, env, Session parameters and a fake

**Files:**
- Create:
  - `src/server/payments/stripe.ts`, `kerb-env.ts`, `checkout-params.ts` and `checkout-params.test.ts`;
  - `src/test/stripe-fake.ts`.
- Modify: `src/server/env.ts` (`getStripeEnv`), `.env.example` (four empty placeholders with a comment), `package.json` (install `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`).

**Interfaces (produces):**
- `getStripeEnv(source?)` returns `{ secretKey: string; webhookSecret: string; testClocks: boolean }`, and throws on a missing secret key.
- `getStripe(): StripeClient`, a memoised instance. `StripeClient` is the subset of `Stripe` Kerb uses: `checkout.sessions.{create,retrieve,expire}`, `customers.{create,retrieve}`, `subscriptions.{retrieve,update,cancel}`, `invoices.{retrieve,pay,finalizeInvoice,voidInvoice}`, `refunds.create`, `paymentIntents.retrieve`, `paymentMethods.retrieve`, `billingPortal.sessions.create`, `testHelpers.testClocks.create` and `webhooks.constructEvent`.
- `kerbEnv(source?): "production" | "preview" | "staging" | "local"`.
- `checkoutParams(input: { quoteId: string; plan: "annual" | "monthly"; amountPence: number; lineName: string; stripeCustomerId: string; baseUrl: string; now: Date }): Stripe.Checkout.SessionCreateParams`.
- `fakeStripe(): StripeClient & { calls: Record<string, unknown[]>; set…(…) }`. It's an in-memory fake that returns ids like `cs_test_1`, records the calls, and lets tests preset retrieve results.

- [ ] **Step 1: Write the failing tests.**
  - `checkoutParams` annual: `mode: "payment"`, one line of `price_data.unit_amount` = amount, `currency: "gbp"`, `payment_method_types: ["card"]`, `ui_mode: "embedded"`, `expires_at` = now + 1800 s, `metadata.kerb_env` and `metadata.quote_id` set, `payment_intent_data.metadata.kerb_env` set, and a `return_url` containing `{CHECKOUT_SESSION_ID}`.
  - `checkoutParams` monthly: `mode: "subscription"`, `recurring.interval: "month"`, and `subscription_data.metadata.kerb_env`.
  - `kerbEnv({ VERCEL_TARGET_ENV: "staging" })` is `"staging"`, and `kerbEnv({})` is `"local"`.
  - `getStripe` with `sk_live_x` throws the test-key message.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project unit src/server/payments`.
- [ ] **Step 3: Implement.** Install the packages with `pnpm add`.
- [ ] **Step 4: Run them and see them pass.** Then run `vp check`.
- [ ] **Step 5: Commit** `feat(payments): Stripe wrapper in test mode, environment tags and Checkout parameters`. Include the spec and this plan, staged by name, in a separate first commit, `docs(plan): 5.6b spec and implementation plan`.

### Task 2: The migration and the data helpers

**Files:**
- Modify:
  - `src/server/db/schema/customers.ts`, `policies.ts` (policies and payments) and `values.ts` (`checkoutSessionStatuses`);
  - `src/server/data/job-rows.ts` (the `stripe_events` 30-day cleanup in `deleteExpiredRows`).
- Create:
  - `src/server/db/schema/payments-stripe.ts`, or add to `policies.ts` (`checkout_sessions`, `stripe_events`), plus the generated `drizzle/0021_*.sql`;
  - `src/server/data/checkout-rows.ts` and `checkout-rows.int.test.ts`.

**Interfaces (produces), all taking `Db | Tx`:**
- `insertCheckoutSession(tx, row): Promise<{ id: string }>`.
- `openCheckoutFor(tx, quoteId): Promise<{ id; stripeSessionId } | null>`.
- `lockCheckoutBySessionId(tx, stripeSessionId)`: the row `FOR UPDATE`, or null.
- `markCheckout(tx, id, status, at?)`.
- `recordStripeEvent(tx, eventId, type, at): Promise<boolean>`: true if new, `INSERT … ON CONFLICT DO NOTHING RETURNING`.
- `setStripeCustomerId(tx, customerId, stripeCustomerId)`.
- Row lookups for Tasks 5 and 6:
  - `paymentsForSubscription(tx, subscriptionId)`;
  - `policiesForSubscription(tx, subscriptionId)`, where the subscription id comes from that quote's payments;
  - `markInstalment(tx, paymentId, patch)`;
  - `setPolicyStatus(tx, policyId, status, { lapsedAt?, cancelledAt? })`.

- [ ] **Step 1: Write the failing tests.**
  - **The schema checks:** a second `open` `checkout_sessions` row for the same quote is refused, and a `completed` row beside an `open` one is allowed. `lapsed_at` set while `active` is refused. `stripe_invoice_id` is unique when not null, and two nulls are fine.
  - **The helpers:** `recordStripeEvent` returns true, then false, for the same id. `lockCheckoutBySessionId` returns null for an unknown id.
  - **The cleanup:** `deleteExpiredRows` removes a 31-day-old event and keeps a 29-day-old one.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project integration src/server/data/checkout-rows.int.test.ts src/server/jobs/daily.int.test.ts`.
- [ ] **Step 3: Implement.**
  - Update the schema, then run `vp run db:generate` (the project's generate script) and commit the SQL.
  - **Follow the 0018 rule:** no new unique index covers existing non-null data, so there's nothing to deduplicate first. Say so in the migration's header comment.
- [ ] **Step 4: Run them and see them pass.** Also run `src/server/db` (constraints) and `src/server/data/permissions.int.test.ts`.
- [ ] **Step 5: Commit** `feat(payments): checkout sessions, Stripe events and the Stripe ids on customers and payments`.

### Task 3: `startCheckout`, and 5.6's purchase moved out of `pay.ts`

**Files:**
- Create: `src/server/quote/purchase.ts` (5.6's steps 1–8 as a function), `src/server/quote/checkout.ts` and `checkout.int.test.ts`.
- Modify: `src/server/quote/pay.ts` (deleted, or reduced to re-exports of copy if anything still imports them), `src/features/quote/server.ts` (`startCheckoutFn` replaces `payFn`), `src/features/quote/pay-copy.ts`.
- Move: 5.6's `pay.int.test.ts` cases into `purchase.int.test.ts`, calling `purchase()` directly with a fixed card and Stripe ids.
- Delete: `src/features/quote/card.ts` and its test, `DECLINED_TEST_CARD` and `CARD_DECLINED`.

**Interfaces:**
- **Consumes:** Task 1 (`getStripe`, `checkoutParams`, `kerbEnv`) and Task 2 (`insertCheckoutSession`, `openCheckoutFor`, `markCheckout`, `setStripeCustomerId`).
- **Produces:**
  - `purchase(tx: Tx, input: { userId: string; customerId: string; quoteId: string; plan: "annual"|"monthly"; startsOn: string; detailsConfirmedAt: Date; coverAcknowledgedAt: Date; card: { brand: string; last4: string }; stripe: { paymentIntentId?: string; subscriptionId?: string; invoiceId?: string; instalmentDates?: string[] }; auditActor: Actor | null; now: Date }): Promise<{ status: "bought"; quoteId; policyReferences: string[]; jobId: number } | { status: "refused"; message: string }>`.
    - It does 5.6's locks, checks, writes, audit and email, unchanged in behaviour.
    - Monthly payment rows take their due dates from `stripe.instalmentDates` when given (Stripe's billing dates).
    - **One extra rule:** an expired quote is allowed when the caller says the checkout started before it expired (`allowExpired: boolean`).
  - `startCheckout: DataWrite<{ clientSecret: string; checkoutId: string }>`.
    - **Input:** `{ quoteId, plan, startsOn, detailsConfirmed: true, coverAcknowledged: true }`, with the `quote.pay` limit and idempotency.
    - **Order of work:**
      1. Check as `purchase()` would, without writing.
      2. Find or create the Stripe customer, with test clocks when the env says so (spec decision 12).
      3. Expire the quote's open session if there is one.
      4. Create the session with `checkoutParams`.
      5. Insert the `checkout_sessions` row.
    - **The Stripe calls** happen inside the write. On an error after the session is created, the row isn't written, so the session expires unused.
  - `startCheckoutFn` in `src/features/quote/server.ts`, using `actorMiddleware` and the `{ input, idempotencyKey }` envelope.

- [ ] **Step 1: Write the failing tests** (fake Stripe):
  - The 5.6 refusals (closing, already bought, expired, not priced, start-date range) create no session.
  - Success: one `checkout_sessions` row `open`, with both confirmation times and `amount_pence`, and the client secret is returned.
  - A second start expires the first session (`calls["checkout.sessions.expire"]`) and leaves one `open` row.
  - The same idempotency key replays without a second session.
  - Monthly creates the Stripe customer once and stores `stripe_customer_id`, and a second checkout reuses it.
  - With `testClocks` on and an existing clock-less customer, a new clock-backed customer replaces it.
  - The moved purchase tests all pass against `purchase()`: annual, monthly with given dates, concurrency, rollback, bundle, and no card number anywhere.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project integration src/server/quote`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Run the same command, plus `src/server/data`, then `vp check`.
- [ ] **Step 5: Commit** `feat(quote): start a Stripe checkout for a quote; 5.6's purchase moves to purchase.ts and the demo card goes`.

### Task 4: `fulfilCheckout`, refunds, `cancel_at`, and the return page

**Files:**
- Create: `src/server/quote/fulfil.ts` and `fulfil.int.test.ts`.
- Modify: `src/features/quote/server.ts` (`confirmCheckoutFn({ quoteId, sessionId })` for the return page), `src/server/audit/actions.ts` (`payment.refunded`), and the email templates and registry (`payment_refunded`).

**Interfaces:**
- **Consumes:** Task 2 (`lockCheckoutBySessionId`, `markCheckout`) and Task 3 (`purchase`).
- **Produces:**
  - `fulfilCheckout(sessionId: string, opts: { auditActor: Actor | null; now?: Date; stripe?: StripeClient }): Promise<{ status: "fulfilled" | "already" | "refunded" | "pending" | "unknown"; quoteId?: string }>`.
  - **Order of work:**
    1. Retrieve the session, expanding `payment_intent.payment_method` and `subscription.default_payment_method`.
    2. `payment_status !== "paid"` → `pending`.
    3. In one transaction: lock the row (`unknown` if there's none), then `fulfilled_at` set → `already`.
    4. Call `purchase()` with the row's answers, the card from the payment method, and the Stripe ids.
    5. **Instalment dates:** for monthly, the subscription item's `current_period_start`, then + n months, 12 dates.
    6. Mark the row `completed` / `fulfilled_at`.
    7. **A refusal or an amount mismatch** (the session's `amount_total`, or the subscription item's unit amount, ≠ `amount_pence`): after rollback, run the refund path in its own transaction. That's cancel the subscription (monthly, no proration), refund the payment intent (or the first invoice's payment), mark the row `refunded`, audit `payment.refunded` and queue `payment_refunded`.
    8. **After commit:** `runSoon` the email (5.6's pattern). For monthly, `subscriptions.update(id, { cancel_at: <12th period end>, proration_behavior: "none" })`, where the 12th period end is the start + 12 months with the day clamped (5.6's `instalmentDates` rule). A failure is logged and swallowed.
  - `confirmCheckoutFn`:
    - **Who:** signed in, and the session's row must belong to the actor's quote. Otherwise it's `NOT_FOUND`.
    - **What:** it calls `fulfilCheckout` with the actor as the audit actor and returns its status.

- [ ] **Step 1: Write the failing tests** (fake Stripe, sessions preset):
  - Annual paid → one policy, the payment `succeeded` with `stripe_payment_intent_id`, and the card from the payment method.
  - Monthly → 12 rows dated from the period start, row 1 `succeeded` with the subscription id, and `cancel_at` called with the 12th period end.
  - Called twice, or concurrently (`Promise.all`) → one policy, and the second returns `already`.
  - `payment_status: "unpaid"` → `pending`, with nothing written.
  - Already bought through another session → cancel (monthly) and refund are called, the row is `refunded`, one `payment.refunded` audit and one `payment_refunded` job are written, and there are no new policies.
  - A wrong amount → refunded the same way.
  - A closing account → refunded.
  - An expired quote whose row was created before `valid_until` → fulfilled.
  - A `cancel_at` call that throws → the purchase still stands.
  - `confirmCheckoutFn` for another customer's quote → `NOT_FOUND`.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project integration src/server/quote/fulfil.int.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Run the same command, plus the audit and email unit tests.
- [ ] **Step 5: Commit** `feat(quote): fulfil a Stripe checkout once, from the webhook or the return page, refunding what can't be honoured`.

### Task 5: The webhook route and the payment events

**Files:**
- Create: `src/routes/api/webhooks/stripe.ts`, `src/server/payments/webhook.ts`, `webhook-handlers.ts` and `webhook.int.test.ts`.
- Modify: the audit actions and email templates (`payment_failed`).

**Interfaces:**
- **Consumes:** Tasks 1, 2 and 4.
- **Produces:**
  - `handleStripeWebhook(request: Request, deps: { stripe: StripeClient; webhookSecret: string; now?: Date }): Promise<Response>`. It reads the raw body (`await request.text()`).
    - **Signature:** `constructEvent` failing → `400`.
    - **Environment:** the object's `metadata.kerb_env`, or for invoices `parent.subscription_details.metadata.kerb_env`, ≠ `kerbEnv()` → `200`. A missing `kerb_env` → `200`, with a warning logged.
    - **Handling:** in one transaction, `recordStripeEvent` returns false → `200`. Otherwise dispatch the event. An unknown type → `200`.
    - **A throw** → `500`, with the transaction rolled back (so the event isn't recorded and Stripe retries). The error is logged with `logSafeError`.
  - **Handlers in this task** (each takes `(tx, event, deps)`):
    - `checkout.session.completed` → `fulfilCheckout` with actor `null`. It's called outside the event's transaction, because fulfil opens its own: record the event after a successful fulfil.
    - `checkout.session.expired` → `markCheckout(expired)` if the row is `open`.
    - `invoice.paid` with `billing_reason !== "subscription_create"` → retrieve the invoice, find its instalment by `stripe_invoice_id` or by period start = `due_on`, and mark it `succeeded` with `paid_at` = `status_transitions.paid_at` (Stripe's time). No rows for the subscription yet → throw (Review Focus 4). The lapsed-policy resume belongs to Task 6.
    - `invoice.payment_failed` → that instalment → `failed` with the invoice id. If the row wasn't already `failed`, queue `payment_failed` to the customer.
  - The route `POST /api/webhooks/stripe` calls `handleStripeWebhook` with `getStripe()` and the env secret, as `resend.ts` does.

- [ ] **Step 1: Write the failing tests**, building signed payloads with `stripe.webhooks.generateTestHeaderString` and the real `constructEvent`:
  - A bad signature gives `400`.
  - Another `kerb_env` gives `200`, with no rows and no event recorded.
  - The same event twice, sequentially and concurrently, is handled once.
  - `checkout.session.completed` fulfils.
  - `invoice.paid` for month 2 marks row 2 by its period, and by its invoice id on a retry.
  - `invoice.paid` before any rows gives `500`, with the event not recorded.
  - `invoice.payment_failed` twice for one invoice gives one email.
  - A handler that throws gives `500`, with no `stripe_events` row.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project integration src/server/payments`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then run `vp check`.
- [ ] **Step 5: Commit** `feat(payments): Stripe webhook: verified, once per event, per environment; checkout, paid and failed payments`.

### Task 6: Lapse, resume, voiding, cancellation and the billing portal

**Files:**
- Modify: `src/server/payments/webhook-handlers.ts`, `src/server/jobs/daily.ts` and its test (the 30-day cancellation as a new daily job type, `payments.lapsed_cancellations`, added to `DAILY_JOBS` and `JobType`, so it retries on its own), and the audit actions and email templates (`cover_lapsed`, `cover_resumed`, `policy_cancelled_unpaid`).
- Create: `src/routes/account_.billing.tsx` (a server-side redirect) and `src/server/payments/lapse.int.test.ts`.

**Interfaces (produces):**
- **Handlers:**
  - `customer.subscription.updated`: retrieve the subscription. If it's `unpaid`, each of its `active` policies → `lapsed`, with `lapsed_at` = the event's `created`. Audit `policy.lapsed` and queue `cover_lapsed`.
  - `invoice.paid` (extends Task 5): afterwards, retrieve the subscription. If it's `active`, each `lapsed` policy → `active`, with `lapsed_at` null. Audit `policy.resumed` and queue `cover_resumed`.
  - `invoice.created`: if the subscription's policy is `lapsed`, `finalizeInvoice` then `voidInvoice`, and that period's instalment stays or becomes `failed`.
  - `customer.updated` with a changed `invoice_settings.default_payment_method`, or `payment_method.attached`: for each of the customer's subscriptions that is `unpaid` when retrieved, set the subscription's `default_payment_method` to the new card, then `invoices.pay` the open invoice whose period was covered (the earliest open, non-void invoice).
  - `customer.subscription.deleted`:
    - **The term is over** (the subscription had a `cancel_at` and `ended_at` ≥ `cancel_at`): nothing.
    - **Already cancelled** (every policy is `cancelled`, because Kerb's 30-day job did it): nothing.
    - **Otherwise:** each `active`/`lapsed` policy → `cancelled` with `cancelled_at`, audited `policy.cancelled_unpaid`.
- **The daily job:** policies `lapsed` with `lapsed_at` ≤ now − 30 days → `subscriptions.cancel` (no proration), the policy → `cancelled` with `cancelled_at`, audit `policy.cancelled_unpaid` (actor null), and queue `policy_cancelled_unpaid`. Each policy is handled in its own transaction, and one failure doesn't stop the others; the job throws at the end if any failed (as closures do).
- **`/account/billing`:**
  - **Who:** signed in only, with `private, no-store`.
  - **What:** with a `stripe_customer_id`, it creates a portal session (return URL `${baseURL}/account`) and redirects to it. Without one, it renders the "You don’t pay monthly…" line with a link to `/account`.

- [ ] **Step 1: Write the failing tests** (signed events, fake Stripe):
  - `unpaid` → lapsed, with `lapsed_at` = the event time, one audit and one email.
  - A stale `unpaid` event after a resume (the subscription now `active`) → no change.
  - `invoice.created` while lapsed → finalize and void are called.
  - A new default card while `unpaid` → the subscription's card is set and the earliest open invoice is paid. While `past_due` → nothing (Review Focus 5).
  - `invoice.paid` while lapsed and the subscription `active` → active, with the resumed email.
  - `deleted` at `cancel_at` → no change.
  - `deleted` otherwise → cancelled.
  - The daily job: lapsed 31 days → cancelled, with Stripe called. Lapsed 29 days → untouched. One Stripe failure doesn't stop the next policy.
  - `/account/billing` without a Stripe customer shows the line. Another user's customer can never be used (the portal session is created only from the actor's own `customers` row).
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project integration src/server/payments src/server/jobs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then run `vp check`.
- [ ] **Step 5: Commit** `feat(payments): lapse on unpaid, void lapsed months, resume on a new card, cancel after 30 days, and the billing portal`.

### Task 7: Confirm and pay with embedded Checkout, You're covered, and `/account`

**Files:**
- Modify: `src/features/quote/PayPage.tsx`, `pay.browser.test.tsx`, `CoveredPage.tsx`, `src/routes/_quote/quote.covered.$quoteId.tsx` (the `session_id` search param), `src/features/auth/AccountPage.tsx`, `account.browser.test.tsx` and `quote.css`.
- Create: `src/features/quote/StripeCheckout.tsx`, a lazy-loaded wrapper around `EmbeddedCheckoutProvider` and `EmbeddedCheckout`, given `clientSecret`.

**Interfaces:**
- **Consumes:** `startCheckoutFn` (Task 3) and `confirmCheckoutFn` (Task 4).
- **Produces:**
  - **PayPage:**
    - **Removed:** the card section and the demo line.
    - **"Continue to payment":** validates the date and both boxes, calls `startCheckoutFn` with the idempotency key `quote.pay:<quoteId>`, then renders `<StripeCheckout clientSecret>` below the summary, with the test-card line under it.
    - **Changing the plan, date or a box** clears the `clientSecret`, which unmounts the form, and rotates the key.
    - **5.6's refusals** show above the button.
  - **CoveredPage:** with `session_id`, it calls `confirmCheckoutFn` once.
    - **`pending`/`unknown`:** "Confirming your payment…", polling `getPurchaseFn` every 2 s for up to 20 s, then the confirmation line.
    - **`fulfilled`/`already`:** the purchase as now.
    - **`refunded`:** a message, "We couldn’t complete this purchase, so we’ve refunded your payment.", with a link to Your saved quotes.
  - **AccountPage:**
    - **A monthly policy** shows `Update your payment card` → `/account/billing`. `listMyPolicies` gains `plan`, or a `monthly: boolean`, from its quote's payments: add it in `src/server/data/policies.ts` with a test.
    - **A `lapsed` policy** shows `Lapsed` with the warning class.

- [ ] **Step 1: Write the failing component tests** (mocking `./server` and `./StripeCheckout`):
  - The button validates first, then mounts the form with the returned secret.
  - Switching the plan unmounts it.
  - A refusal shows.
  - You're covered shows the confirming state and polls, then shows the policy; the refunded message shows.
  - `/account` shows the billing link for a monthly policy only, and Lapsed styled.
- [ ] **Step 2: Run them and see them fail.** Run `vp test --project component src/features/quote/pay.browser.test.tsx src/features/auth` (port 3000 free).
- [ ] **Step 3: Implement.** The Stripe JS is loaded only on the pay page (dynamic import), so other pages don't pay for it.
- [ ] **Step 4: Run them and see them pass.** Then run `vp check` and `vp build`.
- [ ] **Step 5: Commit** `feat(quote): Confirm and pay with Stripe's embedded checkout; You're covered waits for confirmation; billing link on the account`.

### Task 8: E2E, docs, and the full check

**Files:**
- Modify: `e2e/buy.spec.ts` (Stripe's iframe: fill `4242 4242 4242 4242`, `12/30`, `123` and a postcode in the frame; skipped without `E2E_DATABASE_URL` and a test publishable key).
- Docs:
  - `plan/engineering.md`: env vars, the webhook, test mode, the one sandbox with `kerb_env`;
  - `plan/figma.md`: the Purchase frame's card column is now Stripe's form;
  - the spec's "Notes from the build": the pinned API version and any deviations.

  Don't set the done-markers. The PR step does that.

- [ ] **Step 1: Update the E2E.** Run it locally against `vp preview` with `stripe listen` if available. If Stripe can't be reached locally, make sure it skips cleanly, and record exactly what didn't run.
- [ ] **Step 2: Run** `vp check`, `vp test` and `vp build` (port 3000 free). Expected: all green.
- [ ] **Step 3: Update the docs.**
- [ ] **Step 4: Commit** `test(quote): Stripe buy journey E2E; docs for 5.6b`. Don't push or open a PR.
