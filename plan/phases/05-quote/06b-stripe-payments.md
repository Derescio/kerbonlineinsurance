# 5.6b Stripe payments: pay in full or monthly, with billing from webhooks

**Status:** approved (Damion, 14 Nov 2026), building
**Phase:** 05-quote

## Goal

5.6's demo card is replaced by Stripe, in test mode.

- **Paying in full** is a single Stripe payment of the annual total.
- **Paying monthly** is a real Stripe subscription: 12 monthly payments on the same card, the first taken at purchase.
- **Stripe's webhook drives what happens next.** `/api/webhooks/stripe` turns Stripe's events into Kerb's actions:
  - writing the policy;
  - marking each monthly payment paid;
  - warning about a failed payment;
  - lapsing, resuming and finally cancelling cover.

- **Why** (Damion, 14 Nov 2026): Kerb takes payment through a real provider, the customer is billed the way they chose, and the webhook becomes the trigger for actions after the purchase.
- **The video shot:** pay monthly with Stripe's test card inside Kerb's Confirm and pay page, land on You're covered, then fast-forward Stripe's test clock. Month 2's payment is marked paid. A failing card in a later month brings the "update your card" email, the policy lapses, and updating the card resumes it.

## Decisions

1. **Stripe's embedded Checkout** (Damion, 14 Nov 2026, option B).
   - **What stays Kerb's:** Confirm and pay keeps the start date, the plan cards, the summary and the two tick boxes.
   - **What changes:** the "Payment card" form and the Pay button are replaced by "Continue to payment". It creates a Stripe Checkout Session (`ui_mode: "embedded"`) and mounts Stripe's checkout form in that column of the page with `@stripe/react-stripe-js`. The customer never leaves Kerb's journey frame.
   - **The two options considered and not taken:**
     - **A, the hosted Checkout page** (a redirect to Stripe), was simpler but leaves the frame.
     - **C, the custom Payment Element**, matches Figma most closely but is about twice the code.
2. **Test mode only, with one Stripe sandbox and one set of keys for every environment** (Damion, 14 Nov 2026). Local, previews, Staging and Production all use the same `sk_test_…`/`pk_test_…`. Separating them waits until Kerb goes live.
   - **A live key is refused everywhere** for now. The Stripe wrapper throws at startup if the secret key doesn't start with `sk_test_` *(my call: going live will be its own deliberate change)*.
   - **Every Stripe object Kerb creates is tagged with its environment.** That covers the Checkout Session, the subscription, the payment intent and the customer, each carrying `metadata.kerb_env` (`production`, `staging`, `preview` or `local`, from `VERCEL_ENV` and the Staging custom environment).
   - **Each environment's webhook ignores other environments' events.** One sandbox sends every event to every endpoint (Staging's, Production's, and a local `stripe listen`). An event whose object carries another `kerb_env` gets `200` and no action, so Stripe doesn't retry it.
   - **An unknown session or subscription** whose `kerb_env` matches gets `200` with a warning logged. That covers a session from a database since reset.
3. **The two payment kinds:**
   - **In full:** a Session in `payment` mode for `quotes.total_pence`, with one line, e.g. "Kerb car insurance, Comprehensive, KR24 BXL".
   - **Monthly:** a Session in `subscription` mode for the monthly payment (`monthlyPayment(total, rate)`, as 5.6 computes it), with a monthly interval.
     - **It ends after 12 periods:** `fulfilCheckout` sets the subscription's `cancel_at` to exactly the end of the 12th period, read from the subscription item's period end, with no proration. It does this after its transaction commits, in both of its callers, so the subscription can't run on even if the webhook never arrives. A failure is logged and left for the webhook's `checkout.session.completed`, which sets it again (setting it is idempotent).
     - **The schedule:** Stripe takes payment 1 at purchase, then one a month from that day. The payment rows' due dates follow Stripe's billing dates, not the cover start date, which is a change from 5.6.
   - **Both are priced inline** (`price_data`). No Stripe Products or Prices are set up in the dashboard.
   - **Cards only** (`payment_method_types: ["card"]`; Apple Pay and Google Pay come through as cards). A payment row always has a card brand and last four, and no method settles later *(my call, from the builder check)*.
   - **The Stripe API version is pinned** in the wrapper. The plan names it, and the code reads invoices and subscriptions in that version's shape (since `2025-03-31`, an invoice's subscription and payments and a subscription's period end have moved).
4. **A Stripe customer per Kerb customer.** It's created at their first checkout, with their name and email, and its id is kept on `customers.stripe_customer_id`. It's reused after that, so the portal (decision 9) shows every subscription.
5. **Starting a checkout: `startCheckout`.** It replaces 5.6's `payForQuote` as the browser's pay call.
   - **The write:** a `defineWrite` with the `quote.pay` rate rule (10 an hour) and an idempotency key.
   - **It checks everything `payForQuote` checked:** the account state, ownership, priced, not expired and not already bought, plus the start date, the plan and both tick boxes.
   - **Then it records the purchase being attempted:** a `checkout_sessions` row with the quote, plan, start date, both confirmation times, the expected amount and Stripe's session id. It returns the session's `client_secret`.
   - **One open checkout per quote.** A new start expires the quote's previous open session first, so two tabs can't both pay.
   - **The session expires after 30 minutes** (Stripe's minimum). Nothing is written to `quotes` or `policies` yet.
6. **Fulfilling: `fulfilCheckout(sessionId)`, one function with two callers.**
   - **The callers:**
     - the webhook's `checkout.session.completed`;
     - the return page `/quote/covered/$quoteId?session_id=…`, which fetches the session from Stripe on the server. That way You're covered never waits on a webhook, and a preview that Stripe can't reach still completes.
   - **What it does:** it reruns 5.6's purchase transaction (decision 7 of 5.6: lock the users and customer rows, check the account, lock the quote, write the policies, bundle and payments, accept the quote, audit, queue the email) with what the `checkout_sessions` row recorded.
   - **What it adds:**
     - **The audit actor:** `null` (the system) for a webhook, the customer for the return page.
     - **Stripe ids:** the payment intent or subscription id, saved on the payments.
     - **The card:** its brand and last four come from Stripe's payment method, never from Kerb's form.
     - **The amount:** it must equal the row's expected amount.
   - **It's idempotent by session id.** The row's `fulfilled_at` and a unique policy-per-item key mean a second call does nothing and returns the same quote.
   - **A payment Kerb can't honour is refunded automatically.** That covers a quote already bought through another session, an account now closing or closed, and an amount that doesn't match.
     - **The subscription is cancelled first** on a monthly checkout, at once and with no proration, so it never charges again.
     - **Then the payment is refunded,** and the `checkout_sessions` row → `refunded`. No policy or payment rows are written.
     - **It's audited** (`payment.refunded` against the checkout session), and the customer is emailed "We've refunded your payment" with the reason in plain words. An expired quote is still honoured if the payment completed in a session that started before it expired *(my call: the customer paid in good faith)*.
7. **The webhook: `POST /api/webhooks/stripe`.**
   - **The request:** the signature is checked with `STRIPE_WEBHOOK_SECRET` against the raw body, and a bad one gets `400`.
   - **No event is handled twice:** each event id is recorded in `stripe_events` (unique), and a repeat gets `200` with no action.
   - **Events can arrive in any order** (Stripe doesn't promise it). Handlers work from Stripe's current state, not the event's snapshot:
     - each fetches the subscription or invoice again before acting;
     - an instalment is matched by its invoice id, or by billing period for a new invoice, never "the next row";
     - the first invoice is recognised by `billing_reason: "subscription_create"` and handled by fulfilment, not as instalment 2.
   - **Times come from Stripe** (the invoice's paid time, the event's time), not the server clock. A test clock's month then lines up with the rows *(builder check)*.
   - **Each event type** is handled in its own transaction, and an unknown type gets `200` and is ignored.
   - **A handler that throws gets `500`,** so Stripe retries. The error is logged without personal data.
   - **The events and what Kerb does:**

     | Event | Kerb does |
     |---|---|
     | `checkout.session.completed` | `fulfilCheckout` (decision 6). For a subscription, also set `cancel_at` (decision 3) |
     | `invoice.paid` (not `subscription_create`) | that invoice's instalment row → `succeeded`, with `paid_at` and the invoice id; a `lapsed` policy whose subscription is now `active` → `active`, with the "Your cover has resumed" email (decision 8) |
     | `invoice.payment_failed` | the instalment row → `failed`; the first failure of that invoice sends the "We couldn't take this month's payment" email |
     | `customer.subscription.updated` → `unpaid` | if the subscription is still `unpaid` when fetched: the subscription's policies → `lapsed`, with the "You're no longer covered" email |
     | `customer.updated` (a new default card) or `payment_method.attached` | for each of the customer's `unpaid` subscriptions: make the new card the subscription's card, and pay the invoice that failed while covered (decision 8). Stripe won't retry an unpaid subscription by itself |
     | `customer.subscription.deleted` | ended at its `cancel_at` (the term is over): nothing. Cancelled by Kerb's 30-day job: already handled. Anything else: the policies → `cancelled` |
     | `checkout.session.expired` | the `checkout_sessions` row → `expired` |
     | `invoice.created` | on a subscription whose policy is `lapsed`: finalise and void it (decision 8) |

   - **Every state change is audited** with a new action, actor `null`: `policy.lapsed`, `policy.resumed`, `policy.cancelled_unpaid` and `payment.refunded`.
8. **Failed monthly payments** (Damion, 14 Nov 2026):
   - **Stripe retries** (Smart Retries, set in the dashboard). While it does, the subscription is `past_due` and the policy stays **active**, as a grace period. The customer is emailed once per failed invoice: "We couldn't take this month's payment. Update your card so your cover continues.", with a link to `/account/billing`.
   - **When Stripe gives up,** it marks the subscription **unpaid** (a dashboard setting, below). The policy becomes **lapsed**, and the customer is emailed "You're no longer covered. Update your card to resume your cover.", with the same link.
   - **What they owe to resume** (Damion, 14 Nov 2026): the invoice that failed during the grace period, because they were covered then. Invoices Stripe creates while the policy is lapsed are **voided** (no cover, no charge), and their instalment rows stay `failed`. The policy keeps its original end date, so that year may have fewer than 12 paid instalments.
   - **Updating the card** in the portal sends a customer event. Kerb then makes it the subscription's card and pays that invoice (decision 7). On `invoice.paid` the policy goes back to **active**, and the customer is emailed "Your cover has resumed." Voiding happens when an invoice is created for a lapsed policy (`invoice.created` → void), so a resume never pays for a month without cover.
   - **After 30 days lapsed** *(my call; Damion deferred to me)*, the daily job cancels the Stripe subscription, sets the policy to `cancelled` with `cancelled_at`, and emails "Your policy has been cancelled because we couldn't take your payments." A lapsed policy can't be resumed after that. The 30 days run from `policies.lapsed_at`, which is the lapse event's Stripe time. Vercel Cron only runs the daily job on Production; on Staging it runs only when `jobs:daily` is run by hand. Kerb's clock doesn't follow a Stripe test clock, so the 30-day cancellation is proved by tests, not shown on the video.
9. **`/account/billing`** (signed-in only). It creates a Stripe customer-portal session for the customer's `stripe_customer_id` and redirects to it, with a return URL of `/account`.
   - **A customer with no Stripe customer** (no monthly plan) sees "You don't pay monthly, so there's no card to update." with a link back to `/account`.
   - **The portal allows** updating the payment method and viewing invoices only (dashboard setting). Cancelling from the portal is turned off: cancelling a policy is Phase 6's.
   - **On `/account`,** "Your policies" gains a line on a monthly policy, "Update your payment card" → `/account/billing`, and shows `Lapsed` in the warning style.
10. **Confirm and pay changes** (5.6's decision 6, adapted):
    - **Removed:** the Payment card section and the demo-card line.
    - **The button:** "Continue to payment" (the Pay amount moves into Stripe's form). Pressing it validates the start date and both tick boxes as now, then mounts Stripe's form below the summary.
    - **Changing anything after that** (the plan, the date, a tick box) unmounts the form and needs "Continue to payment" again *(my call: the session was created for those answers)*.
    - **5.6's refusals still show** above the button.
    - **Stripe's test cards** are listed under the form: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined, `4000 0025 0000 3155` asks for 3-D Secure, and `4000 0000 0000 0341` can be added but fails when charged later.
11. **You're covered** reads the payment line from the payments rows as now. The card brand and last four are Stripe's. Until the purchase is fulfilled, it shows "Confirming your payment…" and checks again every 2 seconds for up to 20 seconds, then shows "Your payment is being confirmed. We'll email you when your policy is ready." Fulfilment from the return page means this is rare.
12. **Test clocks for the demo** *(my call)*. With `STRIPE_TEST_CLOCKS=true` (Staging only), a Kerb customer's Stripe customer is created on its own test clock. Damion can then advance a customer's month in the dashboard and watch the webhooks act.
    - **A Kerb customer whose Stripe customer has no clock** gets a new, clock-backed one while the flag is on *(a test clock holds only a few customers, so each gets its own)*.
    - **It's off by default,** so previews and Production behave like real time.
13. **Data model** (one migration, generated with the schema):
    - **`customers.stripe_customer_id`** (text, unique, nullable).
    - **`policies.lapsed_at`** (timestamptz, nullable), with a check that it's set only while `lapsed`.
    - **`payments`** (each instalment row is matched by invoice id or billing period, decision 7):
      - `stripe_payment_intent_id`, `stripe_invoice_id` and `stripe_subscription_id` (text, nullable);
      - unique on `stripe_invoice_id` and on `stripe_payment_intent_id` (both nullable, so 5.6's demo rows stay valid);
      - an index on `stripe_subscription_id`.
    - **`checkout_sessions` (new):**
      - `id`;
      - `quote_id` + `customer_id` (composite FK to `quotes`, RESTRICT);
      - `stripe_session_id` (unique);
      - `plan`, `starts_on`, `details_confirmed_at`, `cover_acknowledged_at`;
      - `amount_pence` (the expected total, or the monthly payment);
      - `status` (`open` / `completed` / `expired` / `refunded`), `fulfilled_at`, `created_at`, `updated_at`;
      - a partial unique index for one `open` row per quote.
    - **`stripe_events` (new):** `event_id` (PK), `type` and `received_at`. They're cleaned up after 30 days by the existing housekeeping job. Event bodies aren't kept: `payments` and `checkout_sessions` hold the structured record that ADF picks up later (6.13, Phase 9) (Damion, 14 Nov 2026).
    - **Following the unique-index rule (0018):** none of the new unique indexes cover existing rows with values, so there's nothing to deduplicate first.
14. **Account closure (4.7) keeps working.** `checkout_sessions` and `stripe_events` hold no personal data beyond ids, and closure's "records on file" counts a customer's payments as now. Deleting an account with an active subscription isn't possible, because a policy blocks the delete (4.7). Closing one cancels the Stripe subscription when the policy ends *(left to Phase 6's cancellation; noted here so it isn't forgotten)*.
15. **5.6's demo card goes:**
    - **Removed:** `payForQuote`'s card path, `checkCard`, `DECLINED_TEST_CARD` and the card copy.
    - **Kept:** the purchase transaction itself (`pay-quote.ts`'s helpers, the policy reference, the schedule, the audit and the email), now called by `fulfilCheckout`.
    - **Tests:** 5.6's pay tests move to `fulfilCheckout` with a fake Stripe client.

## Damion's setup (Stripe and Vercel dashboards)

1. **Stripe, in test mode:** copy the secret and publishable keys.
2. **Env vars** (`.env.local`, and Vercel Preview, Staging and Production):
   - `STRIPE_SECRET_KEY` and `VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY` (renamed from `NEXT_PUBLIC_…`; Vite only exposes `VITE_` variables to the browser): the same test keys everywhere (decision 2);
   - `STRIPE_WEBHOOK_SECRET`: each endpoint has its own signing secret. Staging's goes on Staging and Preview, Production's on Production, and `stripe listen`'s in `.env.local`;
   - `STRIPE_TEST_CLOCKS=true` on Staging only.

   `.env.example` gets empty placeholders for all four.
3. **Two webhook endpoints in the one sandbox:**
   - **Staging:** `https://kerbonlineinsurance-staging.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>`. Staging is behind Vercel Authentication, so without the bypass Stripe gets a login page. PR previews have no endpoint: their purchases complete through the return page (decision 6), and their later events are ignored by Staging (decision 2).
   - **Production:** `https://kerbonlineinsurance.vercel.app/api/webhooks/stripe`.
   - **Events:** the nine in decision 7, on both.
   - **Locally,** `stripe listen --events <the nine> --forward-to localhost:3000/api/webhooks/stripe` prints a secret for `.env.local` (the full command is in engineering.md; Stripe CLI 1.55 needs `--events`).
4. **Billing settings:**
   - Smart Retries on.
   - After the last retry, **mark the subscription as unpaid**.
   - Stripe's own customer emails off (Kerb sends its own).
5. **The customer portal:** payment method updates and invoice history on; cancellations and plan changes off.

## In scope

- **Server:**
  - `startCheckout` and `fulfilCheckout`;
  - the webhook route and its handlers;
  - the portal route `/account/billing`;
  - the daily 30-day-lapse cancellation, inside the existing daily jobs;
  - automatic refunds;
  - the Stripe client wrapper (`src/server/payments/stripe.ts`, injectable for tests);
  - the four audit actions and five emails: payment failed, cover lapsed, cover resumed, cancelled unpaid, payment refunded.
- **Data:** the migration in decision 13.
- **UI:**
  - Confirm and pay with the embedded form;
  - You're covered's confirming state;
  - `/account`'s billing line and lapsed status.
- **Docs:**
  - this spec;
  - `phase.md` (a 5.6b row) and `build-plan.md`;
  - `engineering.md` (env vars, webhook, test mode);
  - `figma.md` (the Purchase frame's card column is now Stripe's form).

## Out of scope

- **Live payments.**
- **Cancelling a policy or a subscription by the customer, refunds asked for by the customer, and changing the plan** (Phase 6).
- **Buying a home or a bundle with Stripe** (5.7 reuses this: a bundle is one session for the bundle's total).
- **Stripe Tax, receipts from Stripe, and saving a card for later quotes.**

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | Session parameters: payment mode for the annual total; subscription mode with the monthly payment and a monthly interval; cards only; `kerb_env` metadata; the line description; a live key refused | yes |
| Integration | `startCheckout`: the 5.6 refusals; one open session per quote (the previous one is expired); the rate limit; the idempotency replay; nothing written to quotes or policies | yes |
| Integration | `fulfilCheckout` (fake Stripe): annual makes one policy and one paid payment; monthly makes 12 rows, the first paid, with Stripe's dates; webhook then return page (and the reverse) make one policy; an already-bought quote, a closing account and a wrong amount are refunded, audited and emailed; a failure part-way leaves nothing (5.6's rollback test) | yes |
| Integration | Webhook route: a bad signature gives 400; a repeated event id is ignored; `invoice.paid` marks the next instalment; `payment_failed` marks it failed and emails once; `unpaid` lapses and emails; `invoice.paid` on a lapsed policy resumes it; `subscription.deleted` at its `cancel_at` does nothing, and otherwise cancels; an event tagged with another `kerb_env` gets 200 and changes nothing; events out of order (`invoice.paid` before `checkout.session.completed`, a stale `unpaid` after a resume) end in the right state; `invoice.created` on a lapsed policy voids it; a new card on an `unpaid` subscription pays the invoice that failed while covered, then `invoice.paid` resumes the policy; a throwing handler gives 500 and records nothing | yes |
| Integration | The daily job cancels a policy lapsed 31 days and calls Stripe to cancel; one lapsed 29 days is untouched | yes |
| Component | Confirm and pay: "Continue to payment" validates first; the embedded form mounts (Stripe mocked); changing the plan unmounts it; refusals show. You're covered: the confirming state, then the policy. `/account`: the billing link on a monthly policy; Lapsed styled | yes |
| E2E | At 390 px on a preview: car quote → Buy → sign in → Continue to payment → Stripe's form with `4242…` (Stripe's iframe) → You're covered → `/account`. Skipped without Stripe test keys and `E2E_DATABASE_URL` | yes |
| Manual | On Staging with test clocks: pay monthly; advance a month → payment 2 paid; switch the card to `…0341` in the portal and advance → "couldn't take" email; let the retries run out → lapsed email and Lapsed on `/account`; update the card → resumed. Pay in full with `4000 0025 0000 3155` (3-D Secure) | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] Damion's Stripe and Vercel setup is done and the manual check passes, with the results recorded here.

## Commit message

`feat: pay with Stripe, in full or monthly by subscription, with webhooks that mark each payment, warn about a failed one, lapse and resume cover, and cancel it after 30 days unpaid`

## Notes from the build

- **The API version is pinned** to `2026-10-28.endive` (`stripe@23.1.0`), written as a literal in `stripe.ts`. In that version an invoice's subscription is under `parent.subscription_details` and a subscription's period end is on its item.
- **Cards only** is `allowed_payment_method_types: ["card"]` (R10): `SessionCreateParams` has no `payment_method_types` in this version.
- **`kerbEnv()` reads `VERCEL_TARGET_ENV`** (R9), because `VERCEL_ENV` can't tell Staging from a preview (`env.ts`).
- **Annual checkouts also create a Stripe customer**, so `stripe_customer_id` doesn't mean a monthly plan. `/account/billing` goes by having a monthly policy (a payment row with a subscription id), and otherwise says "You don’t pay monthly, so there’s no card to update." (R12).
- **Closing an account deletes the `checkout_sessions` of the quotes it deletes** (R13).
- **Instalment due dates are the London dates of Stripe's UTC billing times**, and an invoice matches its instalment by its line item's period, not `invoice.period_start`, which is the earliest item timestamp (R14).
- **An invoice for a subscription this database doesn't know gets `200` and a warning** (R15), not a retry for days.
- **`invoice.created` voids only months at or after `lapsed_at`** (Task 6 fixes).
- **A resume goes by Kerb's rows, not Stripe's subscription status** (R18, final review). Stripe's status follows the newest invoice, which Kerb may have voided, so it can read `active` with nothing paid. A lapsed policy resumes only when no instalment is owed: `failed` and not a month Kerb voided for want of cover, which `payments.voided_at` (a second migration, 0022) marks, so a month voided in one lapse never blocks resuming from the next. Which months were covered goes by Kerb's rows too (R20, from the live test-clock run): a Stripe event's `created` is wall-clock time even under a test clock, while invoice periods follow the clock, so comparing them with `lapsed_at` voided the owed month. While a policy is lapsed, a month whose row `failed` while covered is owed and never voided, and any other draft or open invoice is voided. A new card pays every owed invoice, earliest first, whenever the policy is lapsed, whatever Stripe's status (voiding its newest invoice can flip it to `active`). `invoice.paid`, `customer.subscription.updated` (any status) and the 30-day job all use that rule, and the job cancels otherwise, whatever Stripe says. Lapsing also voids any draft or open invoice that isn't owed, so event order doesn't matter. An `unpaid` update lapses only while Stripe still holds an open (or uncollectible) invoice, so a stale `unpaid` after the owed invoice is paid doesn't undo the resume.
- **Kerb charges the months after a resume** (R21, from the live test-clock run). Once the owed invoice is paid, Stripe leaves the subscription `unpaid` (its newest invoice is void) and makes each later month's invoice a draft it never charges. So `invoice.created` for an active policy on an `unpaid` subscription finalises the draft and pays it with the subscription's card. A declined card is retried by Kerb's `payments.retry_invoice` job at 2, 4 and 6 days, then the policy lapses as an unpaid lapse does. The retries run on Kerb's clock, so they're proved by tests, not on a test clock.
- **A void that fails just after Kerb's own finalise is retried once in place** (the live run hit a transient failure there), and a new card skips a subscription Stripe has cancelled.
- **Deleting an account at once expires its open checkout sessions at Stripe** (R17, final review), then deletes its `checkout_sessions` rows before the user (`checkout_sessions_quote_fk` is RESTRICT). If Stripe has a session `complete`, the delete is refused: "A payment of yours is still being processed. Try again in a few minutes." A delete fails while Stripe is unreachable and the account has an open session.
- **The webhook retries a failed `cancel_at`** (final review): if setting it fails after `checkout.session.completed` fulfils, the webhook answers `500` without recording the event, and Stripe's retry sets it again. The return page still logs the failure and carries on.
- **`/account/billing`'s portal session is created in the route loader** with preload off, and the link is a full-page link, so hovering never creates a portal session.
- **Stripe is called while row locks are held** (starting a session, refunding, lapsing). That serialises the calls on a quote or policy, which is wanted, and holds the lock for one API round trip.
- **The E2E skips without `E2E_DATABASE_URL` and a `pk_test_` `VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY`**, so `e2e.yml` (which sets only the first) skips it. It fills Stripe's embedded iframe by label, and wasn't run against a live form in the build, so a label may need a tweak the first time.
- **Copy written during the build, for Damion to sign off:** the `NO_STRIPE_KEY` message, the "Car insurance · Purchase" overline above the form, and the refunded heading.

## Sources

- **Builder check (14 Nov 2026):** setting `cancel_at` in fulfilment, cards only, event order, Kerb paying the invoice on resume, Stripe's times, the API version, refunds cancelling the subscription.
- **Plan:** 5.6's spec (decisions 6–9, and pay's transaction); 4.2 decision 19 (payments); 4.5c (the write tools); 4.7 (closure); 4.10 (the outbox and daily jobs); engineering.md (Vercel protection and the bypass secret).
- **Damion, 14 Nov 2026:**
  - Use Stripe.
  - In full is a single payment, and monthly is billed monthly.
  - The webhook triggers actions.
  - When Stripe gives up, email that cover has stopped and the card needs updating to resume.
  - Embedded Checkout (option B).
  - One sandbox and one set of test keys for every environment, separated when Kerb goes live.
  - A lapsed customer pays the month that failed while covered; months while lapsed are voided; the end date stays.
  - Stripe's event bodies aren't stored; the structured tables are what goes to ADF.
  - The lapse limit was left to me.
