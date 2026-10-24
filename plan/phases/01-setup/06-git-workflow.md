# 1.6 Git workflow and first release

**Status:** spec
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

## Sources

- [engineering.md §1](../../engineering.md#1-branches-and-flow)
- GitHub docs: repository rulesets.

## Files

- `.github/pull_request_template.md`
- (`plan/README.md` already describes the flow.)

## Steps

- [ ] `git switch -c staging main` and push (Damion).
- [ ] Damion sets the rulesets in GitHub (I'll give the exact settings).
- [ ] Make this slice itself the first real slice branch: `slice/1.6-git-workflow` from `staging`, add the PR template, open a PR into `staging`.
- [ ] Watch: `ci` runs, a Vercel preview URL is posted, a direct push to `staging` is rejected.
- [ ] Squash-merge into `staging` and check the staging URL updates.
- [ ] Open the release PR `staging → main`, merge it, check production updates.
- [ ] Tag `s1-setup` on `main` and push the tag (Damion).

## Done when

- [ ] A direct `git push` to `main` or `staging` is refused.
- [ ] The slice PR showed a passing `ci` check and a preview URL.
- [ ] The staging and production URLs both serve the merged change.
- [ ] Tag `s1-setup` exists on `main` on GitHub.

## Commit message

`chore: git workflow, PR template and release flow`
