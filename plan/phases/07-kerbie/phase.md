# Phase 7: Kerbie

**Tag:** `s7-kerbie` · **Status:** todo

## Goal

Kerbie, the AI assistant: general answers for guests, personal answers and confirmed actions for signed-in users, with cost guards and a model comparison.

## Payoff shot

As a guest, ask about excess. Sign in, ask 'when does my policy renew?', then 'add my partner as a driver', tap Confirm on the card, and see the driver on the settings page.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 7.1 | Kerbie UI designed in Figma: bottom-right launcher, glyph avatar (no mascot, per Kerb's no-illustration rule), panel, messages, confirm card, limit reached; Kerbie says it's an AI and hands off to "contact us" | todo |
| 7.2 | Chat route + `useChat` panel, guest mode with knowledge file and streaming. **Perf:** panel lazy-loaded on first open; prompt caching on the stable prefix; Turnstile on the first guest message; replies rendered as limited Markdown (raw HTML stripped, links restricted to Kerb pages) | todo |
| 7.3 | Thread/message storage, `ai_usage` logging, rate limits and daily spend cap; thread summaries run as background jobs | todo |
| 7.4 | Read tools for signed-in users, including `getMyDocuments`; `getReviewSummary` (published reviews only) for guests and users | todo |
| 7.5 | Action tools + approval confirm cards + `kerbie_actions` audit; each confirm card is single-use (idempotency key); change + `kerbie_actions` row in one transaction | todo |
| 7.6 | Eval set (~30 questions) + model comparison → results table → default chosen. **Perf:** runs only via manual `kerbie-eval.yml` workflow | todo |
| 7.7 | Review auto-check: the AI screens each new review and its photos (faces, number plates, personal documents, inappropriate content) for abuse, spam and personal details; clean reviews publish at once, flagged ones go to the admin queue with the reason; the check runs as a background job, so posting a review never waits on the AI | todo |
| 7.8 | Photos to Kerbie: attach button in the panel (4.10 helper, `kerbie_image`, 3 per message, counts towards the daily quota); image passed to the model as a presigned URL; Kerbie can describe damage and offer "start a claim with this photo" via the confirm card; image cases added to the eval set | todo |

## Recording notes

- Vercel AI SDK: one line to swap Claude for OpenAI. Show it.
- Safety talking point: tools always use the session user; the model never picks whose data it reads.
- The comparison table is its own segment: quality, tool accuracy, cost, speed.
- Voice rules come from the repo `readme.md` content fundamentals.

## Exit criteria

- Guest gets no account data.
- User A can't reach user B's data (two accounts + injection prompts).
- Actions only change data after Confirm.
- Spend cap triggers the fallback.
- Deployed and tagged.
