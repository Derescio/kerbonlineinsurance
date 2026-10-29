# 1.6 Git workflow and first release

**Status:** done
**Phase:** 01-setup

## Goal

Switch from bootstrap commits on `main` to the real flow: slice branches → PR → `staging` → release PR → `main`. Prove the whole loop once by shipping Phase 1 and tagging `s1-setup`.

## In scope

- Create the `staging` branch from `main` and push it.
- **Branch protection** (rulesets) on `main` and `staging`:
  - require a PR
  - require the `ci` check
  - branch must be up to date
  - no force pushes or deletions
  - `staging`: squash merge only
  - `main`: merge commit only (release PRs)
- `.github/pull_request_template.md`: slice link, "Done when" checklist, preview URL or screenshots.
- The first release: PR `staging → main`, merge, tag `s1-setup` on `main`.

## Out of scope

- CODEOWNERS or required reviewers. Damion works alone, so requiring a review would block his own merges.
- CodeRabbit (AI PR review): optional, revisit after this slice. Never a required check.

## Sources

- [engineering.md §1](../../engineering.md#1-branches-and-flow)
- GitHub docs: repository rulesets.

## Files

- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`: drop `paths-ignore`, so the required `ci` check also runs on plan-only PRs; add a first step that fails any PR into `main` not from `staging` or `hotfix/*`.
- (`plan/README.md` already describes the flow.)

## Steps

- [x] `git switch -c staging main` and push (Damion).
- [x] Damion sets the rulesets in GitHub (I'll give the exact settings).
- [x] Make this slice itself the first real slice branch: `slice/1.6-git-workflow` from `staging`, add the PR template, open a PR into `staging`.
- [x] Watch: `ci` runs, a Vercel preview URL is posted, a direct push to `staging` is rejected.
- [x] Squash-merge into `staging` and check the staging URL updates.
- [x] Open the release PR `staging → main`, merge it, check production updates.
- [x] Tag `s1-setup` on `main` and push the tag (Damion).

## Notes from the build

- **Rulesets:** "kerb Main Branch Rules" (default branch) and "kerb Staging Branch Rules" (`staging`). Bypass list empty on both, required approvals 0, required check `ci` (GitHub Actions). `staging` allows squash only; `main` allows merge commits only.
- **Up to date:** required on `staging` only. A release merge commit on `main` never reaches `staging`, so a strict rule on `main` would block every later release, and the "Update branch" button would be refused by the `staging` rules.
- **`ci` runs on plan-only PRs:** `paths-ignore: plan/**` is gone. With a required check, a skipped workflow leaves the PR waiting on "Expected" for good.
- **Direct pushes tested:** both refused with `GH013: Repository rule violations` ("Changes must be made through a pull request", "Required status check "ci" is expected").
- **The loop:** PR #9 (`ci` passed, preview posted, needs a login) squash-merged to `staging` as `456ed51`, the first deploy to `kerbonlineinsurance-staging.vercel.app` (anonymous `302` to Vercel SSO, `200` with the bypass header). Release PR #10 merged to `main` as `0efd132`, production deployed and `/api/stream-test` streams. Annotated tag `s1-setup` on `0efd132`.
- **Source-branch guard (added in the close-out):** PR #11 (`buildplanbranch`) went straight into `main`, and the rulesets allowed it because it was a PR with a passing `ci`. Rulesets have no "allowed source branch" setting, so `ci` now starts with a step that fails on a PR into `main` unless the head is `staging` or `hotfix/*`. PR #12 synced `main` back into `staging`.
- **PR bodies:** `gh pr create` fills the body from `.github/pull_request_template.md` (press `e` to edit it in Notepad). Release PRs link `phase.md` in the Slice section.

## Done when

- [x] A direct `git push` to `main` or `staging` is refused.
- [x] The slice PR showed a passing `ci` check and a preview URL.
- [x] The staging and production URLs both serve the merged change.
- [x] Tag `s1-setup` exists on `main` on GitHub.

## Commit message

`chore: git workflow, PR template and release flow`
