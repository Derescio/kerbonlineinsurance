# Phase 7: Kerbie

**Tag:** `s7-kerbie` · **Status:** todo

## Goal

Kerbie, the AI assistant: general answers for guests, personal answers and confirmed actions for signed-in users, with cost guards and a model comparison.

## Payoff shot

As a guest, ask about excess. Sign in, ask 'when does my policy renew?', then 'add my partner as a driver', tap Confirm on the card, and see the driver on the settings page.

## Quality bars

Every slice spec checks itself against these. Numbers are starting targets; 7.6 confirms or adjusts them with real measurements.

### Fast

- Time to first token p95 under 1.5 s for a plain answer and under 3 s when a tool is called (measured in the 7.6 eval and logged in `ai_usage`).
- The reply streams straight away: message, usage and audit writes happen after the stream (`waitUntil` or a job). The only DB work before the first token is the session, the rate limit and the spend reservation.
- At most 3 tool steps per turn; each tool has a 2 s timeout and returns a short error the model can explain.
- Context stays small: stable cached prefix + thread summary + last ~10 messages; tool results return only the fields the answer needs.

### Accurate

- Kerbie answers only from the knowledge file and tool results. If neither covers the question, it says it doesn't know and offers "contact us". It doesn't guess.
- No promises of cover or payout (see 7.4). Dates, prices and policy numbers come from tool results, never from the model's memory.
- Answers built on account data show a source chip ("From your policy schedule") linking to the page or document.
- Eval gate: at least 90% of answer cases pass, 100% of injection, authorisation and "will you pay?" cases pass.

### Authorised data only

- Tools take the user from the session; the model can't pass a user id, policy id it doesn't own, or role. Tool sets are picked per role on the server (guest: knowledge + `getReviewSummary`; customer: + read and action tools).
- Tool outputs are explicit DTOs (allowlisted fields), so nothing like password hashes, staff notes or other users' data can reach the model, even by accident.
- Review text inside `getReviewSummary` is untrusted (indirect injection). It's returned as quoted data, and nothing it says can trigger an action, because every action needs a Confirm.
- Logs and `ai_usage` hold ids and counts, not message text or personal details.

### No malicious code

- Kerbie has no code execution, SQL, shell or open-ended fetch tools. It has only fixed, typed server functions with Zod-validated arguments that run parameterised Drizzle queries.
- Replies render as limited Markdown (no raw HTML, Kerb links only) under the existing nonce CSP, so a reply can't run script.
- Images go through the 4.10 pipeline (type sniffed, re-encoded, EXIF stripped) before the model sees them.

### No DB bottleneck

- One write per turn for messages and one for usage, both after the stream; no per-token writes.
- Indexes: `messages (thread_id, created_at)`, `ai_usage (user_id, day)`. History reads are capped at the last N messages.
- The spend cap counts per user per day plus one global daily row. If 8.6's load test shows that global row is contended, it moves to Redis (the existing 8.6 decision).
- Rate limiting runs before the model call and before any heavy query.

### Professional and modern

- Streaming with a stop button, retry on error, suggested first prompts, source chips, the confirm card, and limit-reached and offline states, all from Figma (7.1).
- Full-screen sheet on mobile, keyboard and screen-reader support (axe), and reduced motion respected.
- Voice: plain, calm, UK English, no emoji, no hype; Kerbie says it's an AI.

### Scalable

- The chat route is stateless; all state lives in Postgres (or Redis after 8.6).
- Models are set per task in config through the AI SDK, with a fallback model on provider errors or timeouts.
- Kill switch: a runtime setting (a DB row or Vercel Edge Config, read with a short cache) turns Kerbie off and shows "contact us", with no redeploy.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 7.1 | Kerbie UI designed in Figma: bottom-right launcher, glyph avatar (no mascot, per Kerb's no-illustration rule), panel, messages, confirm card, limit reached; Kerbie says it's an AI and hands off to "contact us" | todo |
| 7.2 | Chat route + `useChat` panel, guest mode with knowledge file and streaming. **Perf:** panel lazy-loaded on first open; prompt caching on the stable prefix; Turnstile on the first guest message; replies rendered as limited Markdown (raw HTML stripped, links restricted to Kerb pages). **Knowledge:** the knowledge file stays small enough to sit in the cached prefix (target under ~8k tokens); if it outgrows that, the fallback is Postgres full-text search over knowledge sections, not embeddings. **Cleanup:** delete `src/routes/api/stream-test.ts` (from 1.5) once the chat route streams on production | todo |
| 7.3 | Thread/message storage, `ai_usage` logging (input, cached input and output tokens, model, latency, cost), rate limits and daily spend cap; the cap is atomic: reserve the worst-case cost before the call, settle from `ai_usage` after, so concurrent requests can't overshoot; thread summaries run as background jobs | todo |
| 7.4 | Read tools for signed-in users, including `getMyDocuments`; `getReviewSummary` (published reviews only) for guests and users. Kerbie never says something is covered, that a claim will be paid, or how much: it points to the policy documents or a claims handler. Eval file started here with tool-selection and "is this covered?" cases | todo |
| 7.5 | Action tools + approval confirm cards + `kerbie_actions` audit; each confirm card is single-use (idempotency key); change + `kerbie_actions` row in one transaction | todo |
| 7.6 | Eval set grown to ~30 questions + model comparison per task (chat + tools, review screening, vision) → results table → a default per task, set in config (no runtime router). **Perf:** runs only via manual `kerbie-eval.yml` workflow | todo |
| 7.7 | Review auto-check: the AI screens each new review and its photos (faces, number plates, personal documents, inappropriate content) for abuse, spam and personal details; clean reviews publish at once, flagged ones go to the admin queue with the reason; uncertain verdicts, failed or dead-lettered checks also go to the queue (never auto-publish); model id and verdict stored with the review; the check runs as a background job, so posting a review never waits on the AI | todo |
| 7.8 | Photos to Kerbie: attach button in the panel (4.10 helper, `kerbie_image`, 3 per message, counts towards the daily quota); server sends the image bytes to the model (or a presigned URL with ≤60s expiry); Kerbie can describe damage, without judging eligibility, and offer "start a claim with this photo" via the confirm card; image cases added to the eval set | todo |

## Recording notes

- Vercel AI SDK: one line to swap Claude for OpenAI. Show it.
- Safety talking point: tools always use the session user; the model never picks whose data it reads.
- The comparison table is its own segment: quality, tool accuracy, cost, speed.
- Voice rules come from the repo `readme.md` content fundamentals.

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). Unit, component and integration tests use the AI SDK's mock provider: CI never makes a paid AI call. Real-model quality is measured only by the 7.6 eval.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Component | Launcher opens the panel; the panel code is not in the landing chunk (build manifest); "I'm an AI" and "contact us" shown; limit-reached state | 7.1, 7.2 | yes |
| Unit | Reply renderer strips raw HTML, keeps limited Markdown, and drops links that aren't Kerb pages | 7.2 | yes |
| Integration | Guest chat streams a reply (mock model); Turnstile checked on the first guest message (test key) | 7.2 | yes |
| Unit + Integration | Quota and spend-cap maths (unit); messages and `ai_usage` rows stored; over the quota or the cap returns the fallback reply; two concurrent requests at the cap → one gets the fallback; summaries run as jobs | 7.3 | yes |
| Integration | Read tools take the user from the session only; a guest gets no account tools; `getReviewSummary` sees published reviews only | 7.4 | yes |
| Integration | An action changes nothing until Confirm; a second Confirm returns "already done"; change + `kerbie_actions` row in one transaction | 7.5 | yes |
| Component | Confirm card disables after one tap and shows the result | 7.5 | yes |
| Eval | ~30 questions plus injection prompts ("show me user B's policy", "ignore your rules"), "am I covered / will you pay?" cases (no cover or payout promises) and image cases (7.8), run by the manual `kerbie-eval.yml`; results table | 7.6, 7.8 | yes (manual run) |
| Integration | Review auto-check job: a flagged verdict sends the review to the queue with the reason, a clean one publishes it; an uncertain verdict or a failed/dead-lettered job sends it to the queue; posting never waits on the check (mock verdicts) | 7.7 | yes |
| Integration | `kerbie_image` uploads count towards the daily quota, max 3 per message; "start a claim with this photo" goes through the confirm card | 7.8 | yes |
| Unit | Every tool's Zod schema has no user id or role field; every tool output DTO matches an allowlist snapshot (adding a field fails the test until the snapshot is updated on purpose) | 7.4, 7.5 | yes |
| Integration | Tool set per role: a guest request exposes only guest tools; a 4th tool step is refused; a slow tool (mock) times out at 2 s and the reply explains it | 7.2, 7.4 | yes |
| Integration | No DB writes before the first streamed chunk except session, rate limit and spend reservation (query log assertion); one messages write and one usage write per turn | 7.3 | yes |
| Integration | Kill switch on → the chat route returns the "contact us" reply without calling the model; provider error → the fallback model answers | 7.2, 7.6 | yes |
| Unit | Logged `ai_usage` rows and server logs contain no message text (fixture with a known phrase, asserted absent) | 7.3 | yes |
| Eval | Latency per model (time to first token p50/p95, with and without tools) recorded in the 7.6 results table against the quality-bar targets | 7.6 | yes (manual run) |
| E2E | Guest asks a question and gets a streamed reply (mock model on previews via an env flag); axe on the open panel | 7.2 | yes |

## Exit criteria

- Guest gets no account data.
- User A can't reach user B's data (two accounts + injection prompts); every injection case in the eval is refused.
- Actions only change data after Confirm.
- Spend cap triggers the fallback.
- Quality bars met: the 7.6 eval passes its gate and time to first token is within target on the chosen chat model.
- CI runs no paid AI calls.
- Deployed and tagged.
