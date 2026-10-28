# Kerb website plan

## Start here (new session)

**Read in this order:**
1. this README
2. [project-plan.md](project-plan.md): what and why
3. [engineering.md](engineering.md): how it ships and the platform rules
4. [build-plan.md](build-plan.md): the checklist
5. the current phase's `phase.md` and slice files

**Status (24 Oct 2026):**
- Slices 1.1–1.3 are done. Next: **slice 1.4** ([04-ci-pipeline.md](phases/01-setup/04-ci-pipeline.md)). The Vercel project `kerbonlineinsurance` is already linked, but production 404s until Nitro is added in 1.5.
- Phase 1 slices are fully specced and waiting for Damion's go-ahead. Later phases have titles only, and get specced when they start.
- Vite+ v1.3.0 is installed, and `vp env doctor` passes. Vite+ manages Node 24.22.1 and pnpm. The system `node`/`npm` in `C:\Program Files\nodejs` aren't Vite+ shims, which is harmless for `vp` commands.

**Repo:** this folder (`kerb-online-insurance/`) is its own git repo, `Derescio/kerbonlineinsurance` (default branch `main`). All website work, CI and Vercel run from here. The parent `Kerb/` folder (a separate repo) holds the design system and video assets: read from it, and copy what the app needs into this repo.

**Working rules:**
- Damion records each phase for the website video and **commits and merges himself**.
- Build one slice at a time, only after Damion approves its spec.
- Account setup (Vercel, Neon, Cloudflare R2/Turnstile, Google OAuth, GitHub settings) is done by Damion; give him exact steps.
- Say so before running any headless-browser check.
- The design source of truth is Figma file `ajpEaPwbWtwbsSmRheyDAU` (page "High Fidelity Wireframes"; node map in [figma.md](figma.md)) plus the parent folder's `../readme.md` (voice and visual rules) and the coded design system in `../tokens/` and `../components/`.
- Kerb is a fictional insurer. Never invent real-looking review scores or regulator numbers, and keep the "demo, no real cover" notice.

This folder is how the Kerb website gets built: one **phase** per recording session, one **slice** per small, testable step.

- [project-plan.md](project-plan.md): what we're building and why.
- [build-plan.md](build-plan.md): the ordered checklist of every phase and slice.
- `phases/NN-name/phase.md`: the goal, payoff shot, testing plan and recording notes for one session.
- `phases/NN-name/NN-slice.md`: the spec for one slice.
- [engineering.md](engineering.md): git workflow, environments, migrations, CI, caching.
- [research/competitors.md](research/competitors.md): competitor UX review, with takeaways mapped to slices.
- [figma.md](figma.md): Figma pages and frames with node IDs, plus what still needs designing.

## The loop (per slice)

1. **Spec.** Fill in the slice file, including its `## Tests` (taken from the phase's Testing section). Damion reads it and approves it. Tests are written with the code, test-first where the logic is pure.
2. **Branch.** `slice/N.N-name` from `staging`.
3. **Build.** Implement that slice only. Anything else that comes up goes into a later slice's notes.
4. **Check.** `vp check` and `vp test` locally, then the slice's own "Done when" list.
5. **PR.** Open a PR into `staging`: CI runs and Vercel posts a preview URL.
6. **Land.** Damion squash-merges with the slice's commit message. Tick the slice in `build-plan.md` and its `phase.md`.

When every slice in a phase is done, open a release PR `staging → main`, merge it, and tag `main` (for example `s1-setup`). Tags are the cut points for the website video. Slices 1.2–1.3 are the exception: they commit straight to `main` before CI exists.

Slices for a phase are only fully specced when that phase starts, so they match what the code looks like by then.

## Status legend

| Mark | Meaning |
|---|---|
| `todo` | Not started |
| `spec` | Spec written, waiting for approval |
| `in-progress` | Approved and being built |
| `done` | Checked and committed |

## Slice file template

```markdown
# N.N Slice title

**Status:** todo
**Phase:** NN-name

## Goal
One sentence.

## In scope
## Out of scope

## Sources
Figma nodes, repo files to reuse, docs.

## Files
Created or changed.

## Steps
- [ ] ...

## Tests
Per layer (unit / component / integration / E2E / manual): what's tested and the file names. Write "none" for a layer, with the reason.

## Done when
- [ ] Concrete, checkable results (commands, URLs, screens).

## Commit message
```
