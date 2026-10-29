# Git workflow: how a change reaches production

The rules and the step-by-step for getting any change from a branch to the live site. [engineering.md §1](engineering.md#1-branches-and-flow) has the short version; this page is the one to follow.

```text
slice/N.N-name ──PR (squash)──▶ staging ──release PR (merge commit), once per phase──▶ main ──▶ tag sN-name
   CI + preview URL                 staging URL                                    production URL
hotfix/name ──PR──▶ main, then PR main ──▶ staging (squash)
```

| Branch | Deploys to | Who can see it |
|---|---|---|
| `main` | https://kerbonlineinsurance.vercel.app (production) | everyone |
| `staging` | https://kerbonlineinsurance-staging.vercel.app | Damion (Vercel login) |
| any PR branch | a preview URL posted on the PR | Damion (Vercel login) |

---

## The rules

| Rule | Enforced by |
|---|---|
| No direct pushes, force pushes or deletions on `main` or `staging`. No bypass, not even for the owner. | GitHub rulesets |
| Every change reaches `main` or `staging` through a PR, and the `ci` check must pass. | GitHub rulesets |
| PRs into `staging` are **squash** merged. Release PRs into `main` use a **merge commit**. | GitHub rulesets (allowed merge methods) |
| A PR into `staging` must be up to date with `staging`. (`main` doesn't require this: see [Why](#why-it-works-this-way).) | GitHub rulesets |
| PRs into `main` only come from `staging` (a release) or `hotfix/*`. | First step of `ci` ("Check PR source for main") |
| `staging` is released to `main` **once per phase**, after all its slices are merged, and tagged. | Convention: nothing stops an early release, so don't do one by accident |
| One branch per change, made fresh from `staging`. Deleted once merged. | Convention |

**Branch names:** `slice/N.N-name` for a slice (for example `slice/2.1-tokens`), `hotfix/name` for a production fix, and `docs/name` or `test/name` for anything outside a slice.

**PR titles:** a [Conventional Commits](https://www.conventionalcommits.org) message, usually the slice's own "Commit message" (`feat: …`, `fix: …`, `chore: …`, `docs: …`, `test: …`). The squash merge turns the title into the one commit on `staging`, so fix it in the merge box if it came from a branch name.

---

## Steps

### 1. Start a change

```
git switch staging
git pull --ff-only
git switch -c slice/N.N-name
```

The slice spec must be approved before building starts. Build that slice only, and run `vp check` and `vp test` locally. The pre-commit hook formats and lints the files you changed.

### 2. Open the PR into `staging`

```
git push -u origin slice/N.N-name
gh pr create --base staging --title "feat: <slice commit message>"
```

- At "Choose a template", pick `pull_request_template.md`. At "Body", press `e` to fill it in Notepad, then save, close and Submit.
- In the body: link the slice file, copy in its "Done when" list, and add the preview URL or screenshots.
- In the same PR, mark the slice done: Status in the slice file, its row in `phase.md`, its box in `build-plan.md`.

### 3. Checks and review

- `ci` must pass (`vp check`, `vp test`, `vp build`, `pnpm audit`). If it fails, fix it on the same branch and push again. Everything reruns.
- Vercel posts a preview URL. Open it and work through the "Done when" list.
- "This branch is out of date": click **Update branch** and let `ci` run again.

### 4. Merge and clean up

- **Squash and merge.** Check that the title is the commit message, not the branch name.
- **Delete the branch**: the button on the PR, plus `git branch -D slice/N.N-name` locally. After a squash, git still shows the old branch as "N commits ahead". That's expected, because the squash made a new commit. Never keep working on a merged branch.
- Staging redeploys by itself. Check the staging URL.
- Go back to step 1 for the next slice.

### 5. End of phase: the release

Only once every slice in the phase is merged into `staging` and checked on the staging URL.

```
git switch staging
git pull --ff-only
gh pr create --base main --head staging --title "release: Phase N name (sN-name)"
```

- Link `plan/phases/NN-name/phase.md` in the body.
- `ci` passes, and its first step logs `OK: staging -> main`.
- **Create a merge commit**, not squash. Never delete `staging`.
- Production redeploys. Check the production URL.
- Tag it:
  ```
  git switch main
  git pull --ff-only
  git tag -a sN-name -m "Phase N: name"
  git push origin sN-name
  ```
- Update the README status, the build-plan deck (`plan/scope/`) and write that phase's summary script.

### Hotfix: production is broken

```
git switch main
git pull --ff-only
git switch -c hotfix/name
```

1. Fix, push, then PR into `main`. Once `ci` passes, merge with a merge commit.
2. Bring the fix back: `gh pr create --base staging --head main --title "chore: sync main into staging (hotfix/name)"`, then squash-merge. Otherwise `staging` is missing the fix and the next release could undo it.

### Early release (rare)

For changes that must reach `main` before the phase ends, like the CI guard in PR #14. `staging` must hold only finished work: check `git diff origin/main origin/staging` first. Same steps as a release, but no tag.

---

## Never

- Open a PR from a work branch into `main`. `ci` fails it: open it into `staging` instead.
- Push straight to `main` or `staging`. The rulesets refuse it.
- Delete `staging`, or turn on a ruleset bypass.
- Reuse a branch that has already been merged.
- Release partway through a phase: `staging` may hold half-built features.
- Commit secrets. `.env.example` holds empty placeholders only; real values live in `.env.local` and in Vercel.

---

## Why it works this way

- **Squash into `staging`:** one clean commit per slice, titled with the slice's message, so `staging`'s history reads like the build plan.
- **Merge commit into `main`:** each release is one visible merge on `main` that brings in the whole phase, and the tag sits on it.
- **`main` doesn't require "up to date":** each release's merge commit stays on `main` and never comes back to `staging`. A strict rule would call `staging` out of date at every release, and the "Update branch" button would be refused, because it pushes straight to `staging`.
- **No `paths-ignore` in `ci`:** a workflow skipped by a path filter never reports. The required `ci` check would then wait on "Expected" forever, and a docs-only PR could never merge. The cost is about a minute of cached CI on docs PRs. Skipping inside the job is possible, but every future step would need a condition, and a mistake there gives a green tick that checked nothing.
- **The source guard in `ci`:** rulesets can require a PR into `main` but can't limit which branch it comes from (PR #11 went from a work branch straight to `main`). It's a guard against mistakes, not attacks: a PR that edits `ci.yml` could remove it.
- **One release per phase:** each phase is one recording session, its tag is the cut point for the video, and production only ever gets finished phases.

---

## When something looks wrong

| You see | Meaning | Do this |
|---|---|---|
| "This branch is out of date with the base branch" | Something merged into `staging` after you branched | **Update branch**, wait for `ci` |
| Required check "Expected — Waiting for status to be reported" | The `ci` workflow didn't start for this PR | Check the PR targets `staging` or `main` and that `ci.yml` has no path filter |
| `ci` red at "Check PR source for main" | A PR into `main` from a branch other than `staging` or `hotfix/*` | Close it and open it into `staging` |
| `push declined due to repository rule violations` (GH013) | A direct push to `main` or `staging` | Push a branch and open a PR |
| Merged branch shows "N commits ahead" | Squash merge made a new commit; your originals are left behind | Delete the branch |
| Preview or staging URL asks for a login | Vercel Authentication, working as intended | Log in with your Vercel account |

## Settings reference

- **Rulesets:** "kerb Main Branch Rules" (default branch) and "kerb Staging Branch Rules" (`staging`). Both: restrict deletions, block force pushes, require a PR with 0 approvals, require `ci` (GitHub Actions), empty bypass list. `staging`: squash only, up to date required. `main`: merge only, up to date not required.
- **Repo:** merge commits and squash merging allowed. "Automatically delete head branches" is recommended.
- **Dependabot** opens its PRs into `staging` (`target-branch: staging`).
