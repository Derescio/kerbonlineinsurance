# 1.2 Scaffold TanStack Start

**Status:** done
**Phase:** 01-setup

## Goal

Create the TanStack Start app inside `kerb-online-insurance/` with Vite+, running locally with the demo content removed.

## In scope

- `vp create @tanstack/start` into `kerb-online-insurance/` (alongside `plan/`).
- Remove the demo routes, demo components and any add-ons we don't need.
- A single home route that renders "Kerb".
- Confirm `vp dev`, `vp check`, `vp test` and `vp build` all run.

## Out of scope

- Kerb styling (phase 2).
- Database, auth, Tailwind or any extra add-ons. Decline them in the create prompts.

## Sources

- https://viteplus.dev/guide/create (shorthand `@tanstack/start` is supported)
- TanStack Start docs: https://tanstack.com/start/latest

## Files

- New: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/router.tsx` (exact files depend on the current template).
- Unchanged: `plan/`.

## Steps

- [x] Run `vp create @tanstack/start` from `kerb-online-insurance/`. If it won't scaffold into a non-empty folder, scaffold into a temp folder and move the files in, keeping `plan/`.
- [x] Answer the prompts: TypeScript, no Tailwind, no extra add-ons, package manager from 1.1.
- [x] `vp install`.
- [x] `vp dev` and open the local URL.
- [x] Delete the demo routes and components. Make `src/routes/index.tsx` render a plain "Kerb" heading.
- [x] Set the page `<title>` to "Kerb".
- [x] Add a placeholder Vitest test (`src/smoke.test.ts`) so `vp test` has something to run.
- [x] Run `vp check`, `vp test`, `vp build`.

## Done when

- [x] `vp dev` shows "Kerb" at the local URL with no console errors.
- [x] `vp check`, `vp test` and `vp build` exit with 0.
- [x] No demo routes remain in `src/routes/`.

## Results (24 Oct 2026)

- Command (non-interactive; scaffolded in a temp folder, then copied in because this folder already had `plan/` and `.git`):
  `vp create @tanstack/start --no-interactive --package-manager pnpm --no-git --no-hooks --no-agent --no-editor -- kerb-online-insurance --framework React --blank --no-intent --no-git`
  - `--blank` is the TanStack CLI's minimal preset: one route, no demo UI, Tailwind, devtools or tests. So there was nothing to delete.
  - Hooks wait for 1.3, the Nitro deployment adapter for 1.5.
- Versions: TanStack Start 1.169.4, Router 1.170.46, React 19.3.1, TypeScript 6.0.3, Vitest 5.0.5 (via `vite-plus/test`), pnpm 12.15.0 (pinned in `devEngines`), Node 24.22.1.
- Timings for the recording: scaffold + install 23 s; reinstall in place 3.7 s; `vp dev` ready in 1.2 s; `vp check` about 2.5 s on a warm run; `vp build` about 0.4 s (client + server).
- The formatter skips `plan/**` (hand-written prose) and `src/routeTree.gen.ts` (generated): `fmt.ignorePatterns` in `vite.config.ts`.
- `src/routeTree.gen.ts` **is committed** (TanStack's recommendation). `vp check` type-checks before any build in CI, so it must exist in the repo.
- The template already has a `#/*` import alias (`package.json` `imports` + `tsconfig` paths) and `@/*`. 1.3 decides between these and the planned `~/`.
- pnpm reports "Agent skills awaiting approval" for the TanStack packages (a pnpm 12 feature). Left unapproved; not needed.

## Commit message

`chore: scaffold TanStack Start app with Vite+`
